const HOUR_MS = 3_600_000;

export interface TokenExpiryInput {
  now: Date;
  tenantCreatedAt: Date;
  tokenTtlHours: number;
  pendingTtlHours: number;
}

/**
 * When a new verification link stops working: the token lifetime from now, but never later than
 * the moment the clean-up job may purge the pending registration (it deletes tenants
 * `pendingTtlHours` after creation, tokens and all). The email states this time, so it must be
 * true: a link resent at hour 40 of 48 expires at hour 48, not hour 64.
 */
export function registrationTokenExpiry({
  now,
  tenantCreatedAt,
  tokenTtlHours,
  pendingTtlHours,
}: TokenExpiryInput): Date {
  return new Date(
    Math.min(
      now.getTime() + tokenTtlHours * HOUR_MS,
      tenantCreatedAt.getTime() + pendingTtlHours * HOUR_MS,
    ),
  );
}
