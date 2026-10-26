import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigModule } from '../core/config/config.module';
import type { Env } from '../core/config/env.schema';
import { PlatformPrismaService } from '../core/prisma/platform-prisma.service';

/**
 * Minimal module for the platform CLI: configuration and the owner-role database client only.
 * It deliberately leaves out the queue, email and HTTP modules (and the request-scoped
 * PrismaService) so a CLI run starts no workers or schedulers.
 */
@Module({})
export class CliModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: CliModule,
      imports: [ConfigModule.forRoot(env)],
      providers: [PlatformPrismaService],
    };
  }
}
