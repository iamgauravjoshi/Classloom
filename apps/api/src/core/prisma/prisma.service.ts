import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { TenantContext } from '../tenancy/tenant-context';
import {
  createTenantScopedClient,
  type TenantScopedPrismaClient,
} from '../tenancy/tenant-scope.extension';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /**
   * The client for tenant-owned data: queries on TENANT_SCOPED_MODELS are narrowed to the
   * current TenantContext and run under row-level security. The base client (`this`) is for
   * platform-level tables only.
   */
  readonly scoped: TenantScopedPrismaClient;

  constructor(@Inject(ENV) env: Env, tenantContext: TenantContext) {
    super({
      adapter: new PrismaPg({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 2000 }),
    });
    this.scoped = createTenantScopedClient(this, tenantContext);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
