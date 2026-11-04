import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { schoolProfileSchema } from '@classloom/contracts';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';

import {
  FILE_STORAGE,
  type FileStorage,
  StorageUnavailableError,
} from '../../src/core/files/file-storage';
import { FilesService } from '../../src/core/files/files.service';
import { RedisService } from '../../src/core/redis/redis.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createApp } from '../../src/main';
import { SessionService } from '../../src/modules/auth/session.service';
import { AuditService } from '../../src/modules/iam/audit.service';
import { MAX_LOGO_UPLOADS_PER_HOUR } from '../../src/modules/school/school-limits';
import { addMember, seedSchool } from '../auth/helpers';
import { ownerPrisma, startTestInfra, type TestInfra } from '../setup-containers';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE = 'cl_session';
const IMMUTABLE = 'private, max-age=31536000, immutable';
const fixture = (name: string) => readFile(path.join(__dirname, '../fixtures/images', name));

const FULL_PROFILE = {
  name: 'Doon Valley Public School',
  board: 'ICSE',
  legalName: 'Doon Valley Education Trust',
  shortName: 'DVPS',
  establishedYear: 1990,
  udiseCode: '05050101234',
  affiliationNumber: 'UK/ICSE-123',
  schoolType: 'CO_ED',
  residential: 'DAY_AND_BOARDING',
  medium: 'English',
  lowestClass: 'NURSERY',
  highestClass: 'XII',
  phone: '98765 43210',
  email: 'office@doonvalley.in',
  website: 'https://doonvalley.in',
  addressLine1: '12 Rajpur Road',
  addressLine2: 'Near Clock Tower',
  city: 'Mussoorie',
  district: 'Dehradun',
  state: 'UK',
  pinCode: '248179',
};

/** The editable fields of a freshly seeded profile, for building PUT bodies. */
const BLANK_PROFILE = {
  ...Object.fromEntries(Object.keys(FULL_PROFILE).map((k) => [k, null])),
  board: 'CBSE',
  state: 'UK',
  city: 'Dehradun',
};

/** A response body as the assertions read it. */
const bodyOf = (res: request.Response) =>
  res.body as { type?: string; errors?: { path: string }[]; logoUrl?: string | null };

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/** supertest buffers image/png bodies into `res.body`. */
const binary = (req: request.Test) =>
  req.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });

describe('school profile and logo API', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let server: App;
  let owner: PrismaClient;
  let sessions: SessionService;
  let storage: FileStorage;
  let files: FilesService;
  let redis: RedisService;
  let counter = 0;
  let jpeg: Buffer;

  /** A school seeded like registration leaves it (with its profile row), plus Admin and Teacher. */
  async function school() {
    counter += 1;
    const code = `PRO${counter}`;
    const ids = await seedSchool(owner, { code, email: `o${counter}@profile.test` });
    await owner.schoolProfile.create({
      data: { tenantId: ids.tenantId, city: 'Dehradun', state: 'UK' },
    });
    // Admin requires two-step by default; the seeded people have none.
    await owner.role.updateMany({
      where: { tenantId: ids.tenantId, key: 'ADMIN' },
      data: { requiresTwoFactor: false },
    });
    const person = async (roleKey: string) => {
      counter += 1;
      const user = await owner.user.create({
        data: { email: `p${counter}@profile.test`, name: `Person ${counter}` },
      });
      const m = await addMember(owner, ids.tenantId, user.id, roleKey);
      const { token } = await sessions.create({
        tenantId: ids.tenantId,
        userId: user.id,
        membershipId: m.id,
        remember: false,
      });
      return { userId: user.id, cookie: `${COOKIE}=${token}` };
    };
    return {
      code,
      tenantId: ids.tenantId,
      admin: await person('ADMIN'),
      teacher: await person('TEACHER'),
    };
  }

  const get = (path: string, cookie: string) => request(server).get(path).set('Cookie', cookie);
  const put = (path: string, cookie: string) =>
    request(server).put(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
  const del = (path: string, cookie: string) =>
    request(server).delete(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
  const upload = (cookie: string, data: Buffer, filename = 'logo.jpg') =>
    put('/school/logo', cookie).attach('file', data, filename);
  const audits = (tenantId: string, action: string) =>
    owner.auditEvent.findMany({ where: { tenantId, action }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    infra = await startTestInfra({ storage: true });
    app = await createApp(infra.env, { logger: false });
    await app.init();
    server = app.getHttpServer() as App;
    owner = ownerPrisma(infra.env);
    sessions = app.get(SessionService);
    storage = app.get<FileStorage>(FILE_STORAGE);
    files = app.get(FilesService);
    redis = app.get(RedisService);
    jpeg = await fixture('landscape-1024x768.jpg');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await owner?.$disconnect();
    await app?.close();
    await infra?.stop();
  });

  describe('GET /school/profile', () => {
    it('lets a Teacher read the profile with name, board, code and null fields', async () => {
      const s = await school();
      const res = await get('/school/profile', s.teacher.cookie);
      expect(res.status).toBe(200);
      const body = schoolProfileSchema.parse(res.body);
      expect(body).toEqual({
        ...BLANK_PROFILE,
        name: `School ${s.code}`,
        code: s.code,
        logoUrl: null,
      });
    });

    it('needs a session', async () => {
      expect((await request(server).get('/school/profile')).status).toBe(401);
    });
  });

  describe('PUT /school/profile', () => {
    it("refuses a Teacher's change with 403 permission-denied", async () => {
      const s = await school();
      const res = await put('/school/profile', s.teacher.cookie).send(FULL_PROFILE);
      expect(res.status).toBe(403);
      expect(bodyOf(res).type).toBe('permission-denied');
    });

    it("saves every field of an Admin's change, updates tenants and writes one audit row", async () => {
      const s = await school();
      const res = await put('/school/profile', s.admin.cookie).send(FULL_PROFILE);
      expect(res.status).toBe(200);
      const expected = {
        ...FULL_PROFILE,
        phone: '+919876543210',
        code: s.code,
        logoUrl: null,
      };
      expect(schoolProfileSchema.parse(res.body)).toEqual(expected);
      expect((await get('/school/profile', s.teacher.cookie)).body).toEqual(expected);

      const row = await owner.schoolProfile.findUniqueOrThrow({ where: { tenantId: s.tenantId } });
      expect(row.phone).toBe('+919876543210');
      expect(row.udiseCode).toBe('05050101234');
      const tenant = await owner.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });
      expect(tenant).toMatchObject({
        name: FULL_PROFILE.name,
        board: 'ICSE',
        city: 'Mussoorie',
        state: 'UK',
      });

      const events = await audits(s.tenantId, 'school.profile_updated');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorUserId: s.admin.userId,
        targetType: 'school',
        targetId: s.tenantId,
      });
      // Only the changed keys: state and board's tenant values etc. that did not change are absent.
      const before = events[0]!.before as Record<string, unknown>;
      const after = events[0]!.after as Record<string, unknown>;
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      expect(after).not.toHaveProperty('state');
      expect(before).toMatchObject({ name: `School ${s.code}`, board: 'CBSE', city: 'Dehradun' });
      expect(after).toMatchObject({ name: FULL_PROFILE.name, board: 'ICSE', city: 'Mussoorie' });
      expect(before.legalName).toBeNull();
    });

    it('records only the changed key, and nothing when nothing changed', async () => {
      const s = await school();
      await put('/school/profile', s.admin.cookie)
        .send({ ...BLANK_PROFILE, name: `School ${s.code}`, medium: 'Hindi' })
        .expect(200);
      await put('/school/profile', s.admin.cookie)
        .send({ ...BLANK_PROFILE, name: `School ${s.code}`, medium: 'Hindi' })
        .expect(200);
      const events = await audits(s.tenantId, 'school.profile_updated');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ before: { medium: null }, after: { medium: 'Hindi' } });
    });

    it('stores null for an empty optional field', async () => {
      const s = await school();
      await put('/school/profile', s.admin.cookie).send(FULL_PROFILE).expect(200);
      const res = await put('/school/profile', s.admin.cookie).send({
        ...FULL_PROFILE,
        legalName: '',
        phone: '',
        udiseCode: '',
        schoolType: '',
      });
      expect(res.status).toBe(200);
      const row = await owner.schoolProfile.findUniqueOrThrow({ where: { tenantId: s.tenantId } });
      expect(row).toMatchObject({
        legalName: null,
        phone: null,
        udiseCode: null,
        schoolType: null,
      });
    });

    it('gives 400 with field errors for a bad UDISE code and PIN', async () => {
      const s = await school();
      const res = await put('/school/profile', s.admin.cookie).send({
        ...FULL_PROFILE,
        udiseCode: '99123456789',
        pinCode: '012345',
      });
      expect(res.status).toBe(400);
      const paths = bodyOf(res)
        .errors!.map((e) => e.path)
        .sort();
      expect(paths).toEqual(['pinCode', 'udiseCode']);
    });

    it('refuses an established year after the current year', async () => {
      const s = await school();
      const res = await put('/school/profile', s.admin.cookie).send({
        ...FULL_PROFILE,
        establishedYear: new Date().getUTCFullYear() + 1,
      });
      expect(res.status).toBe(400);
      expect(bodyOf(res).errors).toEqual([expect.objectContaining({ path: 'establishedYear' })]);
    });
  });

  describe('logo', () => {
    it('uploads a JPEG, serves it as a cached PNG and audits the change', async () => {
      const s = await school();
      const res = await upload(s.admin.cookie, jpeg);
      expect(res.status).toBe(200);
      const row = await owner.schoolProfile.findUniqueOrThrow({ where: { tenantId: s.tenantId } });
      expect(row.logoFileId).toEqual(expect.any(String));
      expect(bodyOf(res).logoUrl).toBe(`/api/school/logo?v=${row.logoFileId}`);

      const logo = await binary(get(`/school/logo?v=${row.logoFileId}`, s.teacher.cookie));
      expect(logo.status).toBe(200);
      expect(logo.headers['content-type']).toBe('image/png');
      expect(logo.headers.etag).toBe(`"${row.logoFileId}"`);
      expect(logo.headers['cache-control']).toBe(IMMUTABLE);
      expect(await sharp(logo.body as Buffer).metadata()).toMatchObject({
        format: 'png',
        width: 512,
        height: 384,
      });

      const events = await audits(s.tenantId, 'school.logo_changed');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorUserId: s.admin.userId,
        targetType: 'school',
        targetId: s.tenantId,
        before: { logoFileId: null },
        after: { logoFileId: row.logoFileId },
      });
    });

    it('answers 304 to a matching If-None-Match', async () => {
      const s = await school();
      await upload(s.admin.cookie, jpeg).expect(200);
      const { logoFileId } = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
      });
      const res = await get(`/school/logo?v=${logoFileId}`, s.teacher.cookie).set(
        'If-None-Match',
        `"${logoFileId}"`,
      );
      expect(res.status).toBe(304);
    });

    it('needs settings.manage to upload or remove', async () => {
      const s = await school();
      expect((await upload(s.teacher.cookie, jpeg)).status).toBe(403);
      expect((await del('/school/logo', s.teacher.cookie)).status).toBe(403);
    });

    it('replacing the logo deletes the old object and keeps its row', async () => {
      const s = await school();
      await upload(s.admin.cookie, jpeg).expect(200);
      const first = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
        include: { logoFile: true },
      });
      await upload(s.admin.cookie, await fixture('landscape-1024x768.png')).expect(200);
      const second = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
      });
      expect(second.logoFileId).not.toBe(first.logoFileId);
      await expect(storage.get(first.logoFile!.storageKey)).rejects.toThrow();
      expect(await owner.file.count({ where: { id: first.logoFileId! } })).toBe(1);
      expect(await audits(s.tenantId, 'school.logo_changed')).toHaveLength(2);
    });

    it('DELETE clears the logo: GET gives 404 and a logo_removed row is written', async () => {
      const s = await school();
      await upload(s.admin.cookie, jpeg).expect(200);
      const { logoFileId } = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
      });
      const res = await del('/school/logo', s.admin.cookie);
      expect(res.status).toBe(204);
      expect((await get('/school/logo', s.teacher.cookie)).status).toBe(404);
      expect(bodyOf(await get('/school/profile', s.teacher.cookie)).logoUrl).toBeNull();
      const events = await audits(s.tenantId, 'school.logo_removed');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ before: { logoFileId }, after: { logoFileId: null } });

      // Removing again changes nothing and writes no row.
      expect((await del('/school/logo', s.admin.cookie)).status).toBe(204);
      expect(await audits(s.tenantId, 'school.logo_removed')).toHaveLength(1);
    });

    it('GET gives 404 when the school has no logo', async () => {
      const s = await school();
      expect((await get('/school/logo', s.teacher.cookie)).status).toBe(404);
    });

    it('GET gives 404 (not 503) when the row exists but the object is gone', async () => {
      const s = await school();
      await upload(s.admin.cookie, jpeg).expect(200);
      const profile = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
        include: { logoFile: true },
      });
      await storage.delete(profile.logoFile!.storageKey);
      const res = await get(`/school/logo?v=${profile.logoFileId}`, s.teacher.cookie);
      expect(res.status).toBe(404);
    });

    it('refuses an SVG with 422 logo-invalid, reason type', async () => {
      const s = await school();
      const res = await upload(s.admin.cookie, await fixture('svg-renamed.png'), 'logo.png');
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ type: 'logo-invalid', reason: 'type' });
    });

    it('refuses a file over 2 MB with 422 logo-invalid, reason size', async () => {
      const s = await school();
      const big = Buffer.concat([jpeg, Buffer.alloc(2 * 1024 * 1024 + 1 - jpeg.length)]);
      const res = await upload(s.admin.cookie, big);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ type: 'logo-invalid', reason: 'size' });
    });

    it('refuses a request without a file as logo-invalid, and a stray part as 400', async () => {
      const s = await school();
      const empty = await put('/school/logo', s.admin.cookie);
      expect(empty.status).toBe(422);
      expect(empty.body).toMatchObject({ type: 'logo-invalid', reason: 'type' });
      const stray = await put('/school/logo', s.admin.cookie).attach('other', jpeg, 'x.jpg');
      expect(stray.status).toBe(400);
    });

    it('gives 503 storage-unavailable and leaves the profile unchanged when storage is down', async () => {
      const s = await school();
      vi.spyOn(storage, 'put').mockRejectedValue(new StorageUnavailableError('put'));
      const res = await upload(s.admin.cookie, jpeg);
      expect(res.status).toBe(503);
      expect(bodyOf(res).type).toBe('storage-unavailable');
      const row = await owner.schoolProfile.findUniqueOrThrow({ where: { tenantId: s.tenantId } });
      expect(row.logoFileId).toBeNull();
      expect(await owner.file.count({ where: { tenantId: s.tenantId } })).toBe(0);
      expect(await audits(s.tenantId, 'school.logo_changed')).toHaveLength(0);
    });

    it('gives 503 (not 500) when the put stalls past the 5 s transaction window and then fails', async () => {
      const s = await school();
      vi.spyOn(storage, 'put').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        throw new StorageUnavailableError('put');
      });
      const res = await upload(s.admin.cookie, jpeg);
      expect(res.status).toBe(503);
      expect(bodyOf(res).type).toBe('storage-unavailable');
      expect(await owner.file.count({ where: { tenantId: s.tenantId } })).toBe(0);
    });

    it('saves the logo when a slow put outlasts the 5 s transaction window', async () => {
      const s = await school();
      const realPut = storage.put.bind(storage);
      vi.spyOn(storage, 'put').mockImplementation(async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        return realPut(...args);
      });
      const res = await upload(s.admin.cookie, jpeg);
      expect(res.status).toBe(200);
      const row = await owner.schoolProfile.findUniqueOrThrow({ where: { tenantId: s.tenantId } });
      expect(row.logoFileId).not.toBeNull();
    });

    it('removes the stored object when the transaction rolls back after storing it', async () => {
      const s = await school();
      const stored = vi.spyOn(files, 'put');
      const removed = vi.spyOn(files, 'removeObject');
      vi.spyOn(app.get(AuditService), 'record').mockRejectedValueOnce(new Error('audit down'));
      const res = await upload(s.admin.cookie, jpeg);
      expect(res.status).toBe(500);

      const { storageKey } = await (stored.mock.results[0]!.value as Promise<{
        storageKey: string;
      }>);
      expect(removed).toHaveBeenCalledWith(storageKey);
      await expect(storage.get(storageKey)).rejects.toThrow();
      expect(await owner.file.count({ where: { tenantId: s.tenantId } })).toBe(0);
      const row = await owner.schoolProfile.findUniqueOrThrow({ where: { tenantId: s.tenantId } });
      expect(row.logoFileId).toBeNull();
    });

    it(`gives 429 to upload ${MAX_LOGO_UPLOADS_PER_HOUR + 1} in an hour`, async () => {
      const s = await school();
      await redis.client.set(
        `school:logo-uploads:${s.tenantId}`,
        MAX_LOGO_UPLOADS_PER_HOUR - 1,
        'EX',
        3600,
      );
      expect((await upload(s.admin.cookie, jpeg)).status).toBe(200); // the 10th
      const res = await upload(s.admin.cookie, jpeg); // the 11th
      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });

    it("never serves school A's logo to school B", async () => {
      const a = await school();
      const b = await school();
      await upload(a.admin.cookie, jpeg).expect(200);
      const { logoFileId: aFile } = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: a.tenantId },
      });
      // B has no logo: A's versioned URL is still a 404 for B.
      expect((await get(`/school/logo?v=${aFile}`, b.teacher.cookie)).status).toBe(404);

      await upload(b.admin.cookie, await fixture('small-300x100.png'), 'b.png').expect(200);
      const { logoFileId: bFile } = await owner.schoolProfile.findUniqueOrThrow({
        where: { tenantId: b.tenantId },
        include: { logoFile: true },
      });
      const res = await binary(get(`/school/logo?v=${aFile}`, b.teacher.cookie));
      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe(`"${bFile}"`);
      // A stale or foreign version is not cached as immutable.
      expect(res.headers['cache-control']).not.toContain('immutable');
      const aKey = (await owner.file.findUniqueOrThrow({ where: { id: aFile! } })).storageKey;
      expect(res.body).not.toEqual(await readAll(await storage.get(aKey)));
      expect(await sharp(res.body as Buffer).metadata()).toMatchObject({ width: 300, height: 100 });
    });
  });
});
