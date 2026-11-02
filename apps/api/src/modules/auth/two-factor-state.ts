import type { Prisma } from '../../generated/prisma/client';

/**
 * Turns two-step sign-in off for a user, inside the caller's transaction: the secret and its last
 * step, the recovery codes and every device's trust. The one place this happens, shared by the
 * user's own "turn off", a school admin's reset and the platform CLI's `users:disable-2fa`, so
 * they cannot drift apart. Ending sessions, the audit trail and the email stay with each caller.
 */
export async function clearTwoFactorState(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null },
  });
  await tx.recoveryCode.deleteMany({ where: { userId } });
  await tx.knownDevice.updateMany({
    where: { userId, trustedUntil: { not: null } },
    data: { trustedUntil: null },
  });
}
