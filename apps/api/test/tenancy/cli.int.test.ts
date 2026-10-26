import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import type { App } from 'supertest/types';

import { CliModule } from '../../src/cli/cli.module';
import { buildCli } from '../../src/cli/schools.commands';
import { PlatformPrismaService } from '../../src/core/prisma/platform-prisma.service';
import { createApp } from '../../src/main';
import { startTestInfra, type TestInfra } from '../setup-containers';

describe('platform owner CLI', () => {
  let infra: TestInfra;
  let ctx: INestApplicationContext;
  let http: INestApplication;
  let platform: PlatformPrismaService;
  let lines: string[];

  const run = (...args: string[]) => {
    lines = [];
    return buildCli(ctx, (line) => lines.push(line)).parseAsync(args, { from: 'user' });
  };
  const status = async (code: string) =>
    (await platform.tenant.findUniqueOrThrow({ where: { code } })).status;

  async function seed(code: string, email: string) {
    const user = await platform.user.create({
      data: { email, name: email, emailVerifiedAt: new Date() },
    });
    await platform.tenant.create({
      data: {
        code,
        name: `School ${code}`,
        board: 'CBSE',
        city: 'Dehradun',
        state: 'UK',
        contactEmail: email,
        termsAcceptedAt: new Date(),
        status: 'ACTIVE',
        campuses: { create: { name: 'Main', isPrimary: true, city: 'Dehradun', state: 'UK' } },
        memberships: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    ctx = await NestFactory.createApplicationContext(CliModule.forRoot(infra.env), {
      logger: false,
    });
    platform = ctx.get(PlatformPrismaService);
    http = await createApp(infra.env, { logger: false });
    await http.init();
    await seed('GISD', 'owner@gisd.in');
    await seed('OTHR', 'owner@othr.in');
  });

  afterAll(async () => {
    await http?.close();
    await ctx?.close();
    await infra?.stop();
  });

  it('lists schools with status and owner email', async () => {
    await run('schools:list');
    const row = lines.find((l) => l.includes('GISD'));
    expect(row).toContain('ACTIVE');
    expect(row).toContain('owner@gisd.in');
  });

  it('filters the list by status', async () => {
    await run('schools:list', '--status', 'SUSPENDED');
    expect(lines.join('\n')).not.toContain('GISD');
  });

  it('suspends and reactivates a school, logging an audit line', async () => {
    const server = http.getHttpServer() as App;
    await run('schools:suspend', 'gisd', '--reason', 'test');
    expect(await status('GISD')).toBe('SUSPENDED');
    expect(JSON.parse(lines[0]!)).toMatchObject({
      action: 'suspend',
      code: 'GISD',
      before: 'ACTIVE',
      after: 'SUSPENDED',
      reason: 'test',
    });
    expect((await request(server).get('/schools/GISD/public')).status).toBe(404);

    await run('schools:activate', 'GISD');
    expect(await status('GISD')).toBe('ACTIVE');
    expect(JSON.parse(lines[0]!)).toMatchObject({ action: 'activate', before: 'SUSPENDED' });
    expect((await request(server).get('/schools/GISD/public')).status).toBe(200);
  });

  it('rejects a reserved or invalid new code', async () => {
    await expect(run('schools:rename-code', 'GISD', 'admin')).rejects.toThrow(/reserved/);
    await expect(run('schools:rename-code', 'GISD', '1x')).rejects.toThrow(/invalid/);
    expect(await status('GISD')).toBe('ACTIVE');
  });

  it('rejects a code taken by another school', async () => {
    await expect(run('schools:rename-code', 'GISD', 'OTHR')).rejects.toThrow(/already taken/);
  });

  it('renames a code', async () => {
    await run('schools:rename-code', 'GISD', 'GIS-DDN');
    expect(JSON.parse(lines[0]!)).toMatchObject({
      action: 'rename-code',
      before: 'GISD',
      after: 'GIS-DDN',
    });
    expect(await platform.tenant.findUnique({ where: { code: 'GIS-DDN' } })).not.toBeNull();
  });

  it('reports an unknown school', async () => {
    await expect(run('schools:activate', 'GISX')).rejects.toThrow('School GISX not found');
    await expect(run('schools:suspend', 'GISX', '--reason', 'x')).rejects.toThrow(
      'School GISX not found',
    );
  });
});
