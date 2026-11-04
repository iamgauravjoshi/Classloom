import { checklistOf, type OnboardingResponse } from '@classloom/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { RequestAuth } from '../auth/request-auth';

type Actor = Pick<RequestAuth, 'tenantId' | 'permissions'>;

/** Who may work through the checklist (and so who sees it). */
const MANAGE = 'settings.manage';

/**
 * The onboarding checklist (onboarding spec section 9): what is done is read from the profile,
 * the current year and the primary campus, never stored.
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The four items and the timestamps. `visible` is false without `settings.manage`, once every
   * item is done, or after the checklist was dismissed.
   */
  get(auth: Actor): Promise<OnboardingResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const profile = await tx.schoolProfile.findFirst({
        where: { tenantId: auth.tenantId },
        select: {
          udiseCode: true,
          addressLine1: true,
          pinCode: true,
          phone: true,
          logoFileId: true,
          onboardingStartedAt: true,
          onboardingDismissedAt: true,
        },
      });
      if (!profile) throw new Error('School profile row missing for the current tenant');
      const hasCurrentYear =
        (await tx.academicYear.count({ where: { tenantId: auth.tenantId, status: 'CURRENT' } })) >
        0;
      const primaryCampus = (await tx.campus.findFirst({
        where: { tenantId: auth.tenantId, isPrimary: true },
        select: { addressLine1: true, pinCode: true },
      })) ?? { addressLine1: null, pinCode: null };

      // academics: Task 5
      const items = checklistOf({
        profile,
        hasCurrentYear,
        primaryCampus,
        hasCurrentYearSection: false,
        hasClassSubject: false,
      });
      return {
        visible:
          auth.permissions.has(MANAGE) &&
          profile.onboardingDismissedAt === null &&
          items.some((item) => !item.done),
        items,
        startedAt: profile.onboardingStartedAt?.toISOString() ?? null,
        dismissedAt: profile.onboardingDismissedAt?.toISOString() ?? null,
      };
    });
  }

  /** Records that the wizard was opened; only the first time counts. */
  async start(auth: Pick<Actor, 'tenantId'>): Promise<void> {
    await withTenant(this.prisma, auth.tenantId, (tx) =>
      tx.schoolProfile.updateMany({
        where: { tenantId: auth.tenantId, onboardingStartedAt: null },
        data: { onboardingStartedAt: new Date() },
      }),
    );
  }

  /** Hides the checklist for good; only the first dismissal counts. */
  async dismiss(auth: Pick<Actor, 'tenantId'>): Promise<void> {
    await withTenant(this.prisma, auth.tenantId, (tx) =>
      tx.schoolProfile.updateMany({
        where: { tenantId: auth.tenantId, onboardingDismissedAt: null },
        data: { onboardingDismissedAt: new Date() },
      }),
    );
  }
}
