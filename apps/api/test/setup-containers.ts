import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

import type { Env } from '../src/core/config/env.schema';

export interface TestInfra {
  env: Env;
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  stop(): Promise<void>;
}

/** Starts throwaway Postgres 17 and Redis 7 containers; every module's integration tests reuse this. */
export async function startTestInfra(): Promise<TestInfra> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  const env: Env = {
    NODE_ENV: 'test',
    API_PORT: 0,
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    WEB_ORIGIN: 'http://localhost:3000',
  };
  return {
    env,
    postgres,
    redis,
    async stop() {
      // Redis may already have been stopped by a test.
      await Promise.allSettled([postgres.stop(), redis.stop()]);
    },
  };
}
