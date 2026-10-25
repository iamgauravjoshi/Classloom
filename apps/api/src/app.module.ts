import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import { ConfigModule } from './core/config/config.module';
import type { Env } from './core/config/env.schema';
import { HealthModule } from './core/health/health.module';
import { ProblemFilter } from './core/http/problem.filter';
import { PrismaModule } from './core/prisma/prisma.module';
import { RedisModule } from './core/redis/redis.module';

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
        PrismaModule,
        RedisModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useFactory: () => new ProblemFilter(env.NODE_ENV) },
      ],
    };
  }
}
