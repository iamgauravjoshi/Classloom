import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

/**
 * Owner-role client (BYPASSRLS) for platform maintenance only: the clean-up job and the CLI.
 * Never use it for request handling; request code goes through PrismaService, which runs
 * under row-level security.
 */
@Injectable()
export class PlatformPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_MIGRATION_URL,
        connectionTimeoutMillis: 2000,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
