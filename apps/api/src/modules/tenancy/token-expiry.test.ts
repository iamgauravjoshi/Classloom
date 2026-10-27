import { registrationTokenExpiry } from './token-expiry';

const HOUR = 3_600_000;
const createdAt = new Date('2026-11-01T00:00:00Z');
const at = (hours: number) => new Date(createdAt.getTime() + hours * HOUR);
const ttl = { tokenTtlHours: 24, pendingTtlHours: 48 };

describe('registrationTokenExpiry', () => {
  it('gives a fresh registration the full token lifetime', () => {
    expect(registrationTokenExpiry({ now: at(0), tenantCreatedAt: createdAt, ...ttl })).toEqual(
      at(24),
    );
  });

  it('keeps the full lifetime while it ends before the registration is purged', () => {
    expect(registrationTokenExpiry({ now: at(10), tenantCreatedAt: createdAt, ...ttl })).toEqual(
      at(34),
    );
  });

  it('caps a link resent at hour 40 at hour 48, when the registration is purged', () => {
    expect(registrationTokenExpiry({ now: at(40), tenantCreatedAt: createdAt, ...ttl })).toEqual(
      at(48),
    );
  });

  it('returns a time already past once the registration is due for purging', () => {
    const expiry = registrationTokenExpiry({ now: at(49), tenantCreatedAt: createdAt, ...ttl });
    expect(expiry.getTime()).toBeLessThanOrEqual(at(49).getTime());
  });
});
