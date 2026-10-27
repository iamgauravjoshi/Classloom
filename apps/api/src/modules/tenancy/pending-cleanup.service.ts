import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { PrismaService } from '../../core/prisma/prisma.service';

export const MAINTENANCE_QUEUE = 'maintenance';
export const PURGE_PENDING_JOB = 'purge-pending-tenants';

/**
 * Deletes registrations that were never verified. Memberships are under forced row-level
 * security, so the app role alone could not tell whether a user still belongs to an active
 * school. The work is done by the `purge_pending_registrations` SECURITY DEFINER function
 * (see its migration), which the app role may only execute: the API never holds the owner
 * credential.
 */
@Injectable()
export class PendingCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async purgeExpired(now = new Date()): Promise<{ tenants: number; users: number }> {
    const cutoff = new Date(now.getTime() - this.env.PENDING_TENANT_TTL_HOURS * 3_600_000);
    const [counts] = await this.prisma.$queryRaw<{ tenants: number; users: number }[]>`
      SELECT tenants, users FROM purge_pending_registrations(${cutoff}::timestamptz)`;
    return { tenants: counts?.tenants ?? 0, users: counts?.users ?? 0 };
  }
}
