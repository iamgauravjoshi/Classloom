import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { healthResponseSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import {
  FILE_STORAGE,
  type FileStorage,
  StorageObjectNotFoundError,
  StorageUnavailableError,
} from '../src/core/files/file-storage';
import { FilesService } from '../src/core/files/files.service';
import { ImageIntake, type LogoImage } from '../src/core/files/image-intake';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { withTenant } from '../src/core/tenancy/with-tenant';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createApp } from '../src/main';
import { ownerPrisma, startTestInfra, type TestInfra } from './setup-containers';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

describe('core files module (RustFS)', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let prisma: PrismaService;
  let files: FilesService;
  let storage: FileStorage;
  let image: LogoImage;
  const tenantId = randomUUID();

  /** The two steps a caller takes: the put first, then the row inside a tenant transaction. */
  const store = async () => {
    const stored = await files.put({ tenantId, purpose: 'SCHOOL_LOGO', image });
    await withTenant(prisma, tenantId, (tx) => files.insertRow(tx, stored, null));
    return stored;
  };

  beforeAll(async () => {
    infra = await startTestInfra({ storage: true });
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    prisma = app.get(PrismaService);
    files = app.get(FilesService);
    storage = app.get<FileStorage>(FILE_STORAGE);
    await owner.$executeRaw`
      INSERT INTO tenants (id, code, name, board, city, state, contact_email, status,
                           verified_at, terms_accepted_at, updated_at)
      VALUES (${tenantId}::uuid, 'FILES1', 'Files School', 'CBSE', 'Dehradun', 'UK',
              'admin@files1.in', 'ACTIVE', now(), now(), now())`;
    image = await new ImageIntake().toLogoPng(
      await readFile(path.join(__dirname, 'fixtures/images/landscape-1024x768.png')),
    );
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  it('creates the bucket on startup', async () => {
    expect(await storage.ping()).toBe(true);
  });

  it('puts the object, then inserts the row, under tenants/<tenantId>/school_logo/<fileId>.png', async () => {
    const { fileId, storageKey } = await store();
    expect(storageKey).toBe(`tenants/${tenantId}/school_logo/${fileId}.png`);
    expect(await readAll(await storage.get(storageKey))).toEqual(image.data);

    const row = await owner.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(row).toMatchObject({
      tenantId,
      purpose: 'SCHOOL_LOGO',
      storageKey,
      contentType: 'image/png',
      byteSize: image.data.length,
      width: image.width,
      height: image.height,
      createdByUserId: null,
    });
    expect(Buffer.from(row.sha256)).toEqual(image.sha256);
  });

  it('removeObject deletes the object', async () => {
    const { storageKey } = await store();
    await files.removeObject(storageKey);
    await expect(storage.get(storageKey)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('get throws StorageObjectNotFoundError, not StorageUnavailableError, for a missing key', async () => {
    await expect(storage.get(`tenants/${tenantId}/school_logo/missing.png`)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  describe('with the storage container stopped', () => {
    beforeAll(async () => {
      await infra.storage!.stop();
    });

    it('put throws StorageUnavailableError, so no row is ever inserted', async () => {
      const before = await owner.file.count({ where: { tenantId } });
      await expect(store()).rejects.toBeInstanceOf(StorageUnavailableError);
      expect(await owner.file.count({ where: { tenantId } })).toBe(before);
    });

    it('removeObject logs instead of throwing', async () => {
      await expect(files.removeObject(`tenants/${tenantId}/school_logo/x.png`)).resolves.toBe(
        undefined,
      );
    });

    it('/health reports storage down but stays 200 while Postgres and Redis are up', async () => {
      const res = await request(server).get('/health');
      expect(res.status).toBe(200);
      expect(healthResponseSchema.parse(res.body)).toEqual({
        status: 'ok',
        checks: { database: 'up', redis: 'up', storage: 'down' },
      });
    });
  });
});
