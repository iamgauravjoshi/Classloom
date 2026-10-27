import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

export const MISSING_MIGRATION_URL =
  'DATABASE_MIGRATION_URL (the owner role) must be set to run the platform CLI.';

/**
 * Owner-role client (BYPASSRLS) for the platform CLI only; provided by CliModule and never by
 * the API. The API's hourly clean-up uses the `purge_pending_registrations` SECURITY DEFINER
 * function instead, so the request-serving process never holds the owner credential.
 */
@Injectable()
export class PlatformPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    if (!env.DATABASE_MIGRATION_URL) throw new Error(MISSING_MIGRATION_URL);
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_MIGRATION_URL,
        connectionTimeoutMillis: 2000,
        // One command at a time; a second connection covers Prisma's occasional parallel query.
        max: 2,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
