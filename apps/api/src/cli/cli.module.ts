import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigModule } from '../core/config/config.module';
import type { Env } from '../core/config/env.schema';
import {
  MISSING_MIGRATION_URL,
  PlatformPrismaService,
} from '../core/prisma/platform-prisma.service';

/**
 * Minimal module for the platform CLI: configuration and the owner-role database client only.
 * It deliberately leaves out the queue, email and HTTP modules (and the request-scoped
 * PrismaService) so a CLI run starts no workers or schedulers. It is the only place the
 * owner-role client is provided.
 */
@Module({})
export class CliModule {
  static forRoot(env: Env): DynamicModule {
    // The API runs without the owner URL; the CLI cannot, so say so before connecting.
    if (!env.DATABASE_MIGRATION_URL) throw new Error(MISSING_MIGRATION_URL);
    return {
      module: CliModule,
      imports: [ConfigModule.forRoot(env)],
      providers: [PlatformPrismaService],
    };
  }
}
