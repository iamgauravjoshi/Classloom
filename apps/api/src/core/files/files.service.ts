import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';
import type { FilePurpose } from '../../generated/prisma/enums';
import { FILE_STORAGE, type FileStorage, StorageUnavailableError } from './file-storage';
import type { LogoImage } from './image-intake';

export interface PutFileInput {
  tenantId: string;
  purpose: FilePurpose;
  image: LogoImage;
}

/** An object already in storage, waiting for its `files` row. */
export interface StoredObject extends PutFileInput {
  fileId: string;
  storageKey: string;
}

/** `tenants/<tenantId>/<purpose>/<fileId>.png`, built only from ids the API generated. */
export function storageKeyFor(tenantId: string, purpose: FilePurpose, fileId: string): string {
  return `tenants/${tenantId}/${purpose.toLowerCase()}/${fileId}.png`;
}

/**
 * Stores files in two steps so no storage call ever runs inside a database transaction (spec
 * sections 5 and 11): `put` uploads the object before the transaction opens, `insertRow` writes
 * its `files` row inside it. A caller whose transaction fails removes the object again.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  /** Uploads the object under a fresh id. Any failure is a StorageUnavailableError. */
  async put(input: PutFileInput): Promise<StoredObject> {
    const fileId = randomUUID();
    const storageKey = storageKeyFor(input.tenantId, input.purpose, fileId);
    try {
      await this.storage.put(storageKey, input.image.data, 'image/png');
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      throw new StorageUnavailableError('put', { cause: error });
    }
    return { ...input, fileId, storageKey };
  }

  /** Inserts the `files` row for an object `put` stored, with `tx` (the tenant transaction). */
  async insertRow(
    tx: Prisma.TransactionClient,
    { fileId, tenantId, purpose, storageKey, image }: StoredObject,
    /** Null for the system and the CLI. */
    userId: string | null,
  ): Promise<void> {
    await tx.file.create({
      data: {
        id: fileId,
        tenantId,
        purpose,
        storageKey,
        contentType: 'image/png',
        byteSize: image.data.length,
        width: image.width,
        height: image.height,
        sha256: new Uint8Array(image.sha256),
        createdByUserId: userId,
      },
    });
  }

  /** Deletes an object; a failure is logged (the object is left behind), never thrown. */
  async removeObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not delete stored object ${key}; it is left behind (${reason})`);
    }
  }
}
