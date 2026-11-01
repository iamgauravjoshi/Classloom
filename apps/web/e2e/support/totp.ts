import { type APIRequestContext, expect } from '@playwright/test';
import { generateSync } from 'otplib';

import { signInWithCode, type VerifiedSchool, WEB_ORIGIN } from './school';

/** The 6-digit app code for a base32 secret, at `now` (default: the current time). */
export function totpCode(secret: string, now: Date = new Date()): string {
  return generateSync({ secret, epoch: Math.floor(now.getTime() / 1000) });
}

/** Writes through the web app's `/api` proxy, as a browser would send them. */
const post = (request: APIRequestContext, path: string, data?: unknown) =>
  request.post(`${WEB_ORIGIN}/api${path}`, { data, headers: { origin: WEB_ORIGIN } });

export interface TwoFactorSecrets {
  /** Base32, as an authenticator app stores it. */
  secret: string;
  recoveryCodes: string[];
}

/**
 * Turns two-step sign-in on for a school's owner, through the API: signs in with an emailed code
 * (so the sign-in is recent), starts the setup, and enables it with a code computed from the
 * secret. Use a request context of its own: the session it signs in stays out of the browser.
 */
export async function enableTwoFactorFor(
  request: APIRequestContext,
  school: Pick<VerifiedSchool, 'code' | 'email'>,
  /** Also sets this password, so a test can reach the two-step step by password (an emailed code can only be asked for once a minute). */
  password?: string,
): Promise<TwoFactorSecrets> {
  await signInWithCode(request, school);
  if (password) {
    const set = await request.put(`${WEB_ORIGIN}/api/me/password`, {
      data: { newPassword: password },
      headers: { origin: WEB_ORIGIN },
    });
    expect(set.status(), await set.text()).toBe(204);
  }

  const setup = await post(request, '/me/two-factor/setup');
  expect(setup.status(), await setup.text()).toBe(200);
  const { secret } = (await setup.json()) as { secret: string };

  const enabled = await post(request, '/me/two-factor/enable', { code: totpCode(secret) });
  expect(enabled.status(), await enabled.text()).toBe(200);
  const { recoveryCodes } = (await enabled.json()) as { recoveryCodes: string[] };
  return { secret, recoveryCodes };
}
