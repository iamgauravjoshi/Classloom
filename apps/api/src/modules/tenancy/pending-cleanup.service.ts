import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { PlatformPrismaService } from '../../core/prisma/platform-prisma.service';

export const MAINTENANCE_QUEUE = 'maintenance';
export const PURGE_PENDING_JOB = 'purge-pending-tenants';

/**
 * Deletes registrations that were never verified. Runs on the owner-role client: memberships
 * are under forced RLS, so the app role would see none and the "no memberships" user query
 * would match members of active schools.
 */
@Injectable()
export class PendingCleanupService {
  constructor(
    private readonly platform: PlatformPrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async purgeExpired(now = new Date()): Promise<{ tenants: number; users: number }> {
    const cutoff = new Date(now.getTime() - this.env.PENDING_TENANT_TTL_HOURS * 3_600_000);
    // Campuses, memberships and registration tokens cascade with the tenant.
    const tenants = await this.platform.tenant.deleteMany({
      where: { status: 'PENDING_VERIFICATION', createdAt: { lt: cutoff } },
    });
    const users = await this.platform.user.deleteMany({
      where: { emailVerifiedAt: null, memberships: { none: {} } },
    });
    return { tenants: tenants.count, users: users.count };
  }
}
