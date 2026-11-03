import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Client } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import type { Env } from '../src/core/config/env.schema';
import { PrismaClient } from '../src/generated/prisma/client';

const execFileAsync = promisify(execFile);
const apiDir = path.resolve(__dirname, '..');
const rolesSqlPath = path.resolve(apiDir, '../../docker/postgres/init/01-roles.sql');

export interface TestInfra {
  env: Env;
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  mailpit?: StartedTestContainer;
  mailpitApiUrl?: string;
  /** RustFS, when started with `storage: true`. */
  storage?: StartedTestContainer;
  stop(): Promise<void>;
}

/** An owner-role (BYPASSRLS) client for tests that seed or inspect rows across tenants. */
export function ownerPrisma(env: Env): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_MIGRATION_URL }),
  });
}

function urlAs(connectionUri: string, role: string): string {
  const url = new URL(connectionUri);
  url.username = role;
  url.password = role;
  return url.toString();
}

/**
 * Applies migrations as the owner role. `prismaConfig` points `prisma migrate deploy` at another
 * config file, for example one whose migrations folder stops before the migration under test.
 */
export async function applyMigrations(migrationUrl: string, prismaConfig?: string): Promise<void> {
  await execFileAsync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'deploy', ...(prismaConfig ? ['--config', prismaConfig] : [])],
    {
      cwd: apiDir,
      shell: process.platform === 'win32',
      env: { ...process.env, DATABASE_MIGRATION_URL: migrationUrl },
    },
  );
}

const S3_ACCESS_KEY = 'classloom-test';
const S3_SECRET_KEY = 'classloom-test-secret';
/** Where suites without the storage container point S3: nothing listens there. */
const UNREACHABLE_S3_ENDPOINT = 'http://127.0.0.1:1';

/** RustFS (S3-compatible), the image docker/compose.yml runs. The API creates the bucket itself. */
function startStorage(): Promise<StartedTestContainer> {
  return new GenericContainer('rustfs/rustfs:1.0.4')
    .withEnvironment({ RUSTFS_ACCESS_KEY: S3_ACCESS_KEY, RUSTFS_SECRET_KEY: S3_SECRET_KEY })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/health', 9000).forStatusCode(200))
    .start();
}

/**
 * Starts throwaway Postgres 17 and Redis 7 containers (plus Mailpit and RustFS storage on
 * request), creates the owner and app roles, and applies migrations as the owner.
 * `env.DATABASE_URL` connects as the restricted `classloom_app` role, exactly as the API does in
 * production. `prismaConfig` applies another config's migrations instead of the API's own (see
 * `applyMigrations`). Without `storage`, S3 points at an unreachable endpoint (storage is down).
 */
export async function startTestInfra(
  options: { mailpit?: boolean; storage?: boolean; prismaConfig?: string } = {},
): Promise<TestInfra> {
  const [postgres, redis, mailpit, storage] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
    options.mailpit
      ? new GenericContainer('axllent/mailpit:v1.31.2').withExposedPorts(1025, 8025).start()
      : undefined,
    options.storage ? startStorage() : undefined,
  ]);

  const superuserUri = postgres.getConnectionUri();
  const admin = new Client({ connectionString: superuserUri });
  await admin.connect();
  try {
    await admin.query(await readFile(rolesSqlPath, 'utf8'));
  } finally {
    await admin.end();
  }

  const migrationUrl = urlAs(superuserUri, 'classloom_owner');
  await applyMigrations(migrationUrl, options.prismaConfig);

  const env: Env = {
    NODE_ENV: 'test',
    API_PORT: 0,
    DATABASE_URL: urlAs(superuserUri, 'classloom_app'),
    DATABASE_MIGRATION_URL: migrationUrl,
    REDIS_URL: redis.getConnectionUrl(),
    WEB_ORIGIN: 'http://localhost:3000',
    SMTP_URL: mailpit
      ? `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`
      : 'smtp://localhost:1025',
    EMAIL_FROM: 'Classloom <no-reply@classloom.local>',
    REGISTRATION_RATE_LIMIT_PER_HOUR: 5,
    CODE_AVAILABILITY_RATE_LIMIT_PER_MINUTE: 60,
    RESEND_RATE_LIMIT_PER_HOUR: 10,
    REGISTRATION_TOKEN_TTL_HOURS: 24,
    PENDING_TENANT_TTL_HOURS: 48,
    AUTH_SECRET: 'integration-test-auth-secret-0123456789',
    TOTP_ENCRYPTION_KEY: randomBytes(32),
    COOKIE_SECURE: false,
    TRUST_PROXY: 'loopback',
    SIGN_IN_RATE_LIMIT_PER_15_MIN: 30,
    CODE_REQUEST_RATE_LIMIT_PER_HOUR: 10,
    PASSWORD_RESET_RATE_LIMIT_PER_HOUR: 10,
    S3_ENDPOINT: storage
      ? `http://${storage.getHost()}:${storage.getMappedPort(9000)}`
      : UNREACHABLE_S3_ENDPOINT,
    S3_BUCKET: 'classloom-test',
    S3_ACCESS_KEY,
    S3_SECRET_KEY,
    S3_FORCE_PATH_STYLE: true,
  };
  return {
    env,
    postgres,
    redis,
    mailpit,
    mailpitApiUrl: mailpit
      ? `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`
      : undefined,
    storage,
    async stop() {
      // Redis and storage may already have been stopped by a test.
      await Promise.allSettled([postgres.stop(), redis.stop(), mailpit?.stop(), storage?.stop()]);
    },
  };
}
