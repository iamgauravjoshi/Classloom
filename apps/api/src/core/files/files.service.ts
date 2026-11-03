import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';
import type { FilePurpose } from '../../generated/prisma/enums';
import { FILE_STORAGE, type FileStorage, StorageUnavailableError } from './file-storage';
import type { LogoImage } from './image-intake';

export interface StoreFileInput {
  tenantId: string;
  purpose: FilePurpose;
  image: LogoImage;
  /** Null for the system and the CLI. */
  userId: string | null;
}

/** `tenants/<tenantId>/<purpose>/<fileId>.png`, built only from ids the API generated. */
export function storageKeyFor(tenantId: string, purpose: FilePurpose, fileId: string): string {
  return `tenants/${tenantId}/${purpose.toLowerCase()}/${fileId}.png`;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  /**
   * Puts the object first, then inserts the `files` row with `tx` (the caller's tenant
   * transaction). A failed put throws StorageUnavailableError before any row is written; if the
   * insert fails, the object just written is removed again.
   */
  async store(
    tx: Prisma.TransactionClient,
    { tenantId, purpose, image, userId }: StoreFileInput,
  ): Promise<{ fileId: string; storageKey: string }> {
    const fileId = randomUUID();
    const storageKey = storageKeyFor(tenantId, purpose, fileId);
    try {
      await this.storage.put(storageKey, image.data, 'image/png');
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      throw new StorageUnavailableError('put', { cause: error });
    }
    try {
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
    } catch (error) {
      await this.removeObject(storageKey);
      throw error;
    }
    return { fileId, storageKey };
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
