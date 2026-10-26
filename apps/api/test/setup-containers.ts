import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Client } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

import type { Env } from '../src/core/config/env.schema';

const execFileAsync = promisify(execFile);
const apiDir = path.resolve(__dirname, '..');
const rolesSqlPath = path.resolve(apiDir, '../../docker/postgres/init/01-roles.sql');

export interface TestInfra {
  env: Env;
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  mailpit?: StartedTestContainer;
  mailpitApiUrl?: string;
  stop(): Promise<void>;
}

function urlAs(connectionUri: string, role: string): string {
  const url = new URL(connectionUri);
  url.username = role;
  url.password = role;
  return url.toString();
}

/**
 * Starts throwaway Postgres 17 and Redis 7 containers (plus Mailpit on request), creates the
 * owner and app roles, and applies migrations as the owner. `env.DATABASE_URL` connects as the
 * restricted `classloom_app` role, exactly as the API does in production.
 */
export async function startTestInfra(options: { mailpit?: boolean } = {}): Promise<TestInfra> {
  const [postgres, redis, mailpit] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
    options.mailpit
      ? new GenericContainer('axllent/mailpit:v1.31.2').withExposedPorts(1025, 8025).start()
      : undefined,
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
  await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: apiDir,
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_MIGRATION_URL: migrationUrl },
  });

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
    REGISTRATION_TOKEN_TTL_HOURS: 24,
    PENDING_TENANT_TTL_HOURS: 48,
  };
  return {
    env,
    postgres,
    redis,
    mailpit,
    mailpitApiUrl: mailpit
      ? `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`
      : undefined,
    async stop() {
      // Redis may already have been stopped by a test.
      await Promise.allSettled([postgres.stop(), redis.stop(), mailpit?.stop()]);
    },
  };
}
