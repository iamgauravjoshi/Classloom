import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import { ConfigModule } from './core/config/config.module';
import type { Env } from './core/config/env.schema';
import { EmailModule } from './core/email/email.module';
import { HealthModule } from './core/health/health.module';
import { ProblemFilter } from './core/http/problem.filter';
import { RedisThrottlerStorage } from './core/http/redis-throttler.storage';
import {
  AVAILABILITY_THROTTLER,
  REGISTRATION_THROTTLER,
  RESEND_THROTTLER,
} from './core/http/throttler-names';
import { PrismaModule } from './core/prisma/prisma.module';
import { QueueModule } from './core/queue/queue.module';
import { RedisModule } from './core/redis/redis.module';
import { RedisService } from './core/redis/redis.service';
import { TenancyCoreModule } from './core/tenancy/tenancy-core.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

const LOG_LEVEL: Record<Env['NODE_ENV'], string> = {
  development: 'debug',
  test: 'silent',
  production: 'info',
};

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRoot({
          pinoHttp: {
            level: LOG_LEVEL[env.NODE_ENV],
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
        }),
        TenancyCoreModule,
        PrismaModule,
        RedisModule,
        // No global default: each public route opts in with ThrottlerGuard and skips the other
        // named limits via @SkipThrottle.
        ThrottlerModule.forRootAsync({
          inject: [RedisService],
          useFactory: (redis: RedisService) => ({
            storage: new RedisThrottlerStorage(redis),
            throttlers: [
              {
                name: REGISTRATION_THROTTLER,
                limit: env.REGISTRATION_RATE_LIMIT_PER_HOUR,
                ttl: 3_600_000,
              },
              {
                name: AVAILABILITY_THROTTLER,
                limit: env.CODE_AVAILABILITY_RATE_LIMIT_PER_MINUTE,
                ttl: 60_000,
              },
              {
                name: RESEND_THROTTLER,
                limit: env.RESEND_RATE_LIMIT_PER_HOUR,
                ttl: 3_600_000,
              },
            ],
          }),
        }),
        QueueModule.forRoot(env),
        EmailModule,
        HealthModule,
        TenancyModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useFactory: () => new ProblemFilter(env.NODE_ENV) },
      ],
    };
  }
}
