import { type DynamicModule, Module } from '@nestjs/common';
import Redis from 'ioredis';

import { ConfigModule } from '../core/config/config.module';
import type { Env } from '../core/config/env.schema';
import { EmailService } from '../core/email/email.service';
import {
  MISSING_MIGRATION_URL,
  PlatformPrismaService,
} from '../core/prisma/platform-prisma.service';
import { ENQUEUE_TIMEOUT_MS, QueueProducer } from '../core/queue/queue.module';

/**
 * Minimal module for the platform CLI: configuration, the owner-role database client, and a
 * queue producer with `EmailService` so a command can send a notice. It deliberately leaves
 * out the workers, schedulers, HTTP modules and the request-scoped PrismaService, so a CLI run
 * starts no workers (the API's email worker delivers what the CLI queues). It is the only
 * place the owner-role client is provided.
 */
@Module({})
export class CliModule {
  static forRoot(env: Env): DynamicModule {
    // The API runs without the owner URL; the CLI cannot, so say so before connecting.
    if (!env.DATABASE_MIGRATION_URL) throw new Error(MISSING_MIGRATION_URL);
    return {
      module: CliModule,
      imports: [ConfigModule.forRoot(env)],
      providers: [
        PlatformPrismaService,
        // Built when the app starts (not here), and closed with it, like the API's producer.
        {
          provide: QueueProducer,
          useFactory: () =>
            new QueueProducer(
              new Redis(env.REDIS_URL, {
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
                connectTimeout: ENQUEUE_TIMEOUT_MS,
              }),
            ),
        },
        EmailService,
      ],
    };
  }
}
