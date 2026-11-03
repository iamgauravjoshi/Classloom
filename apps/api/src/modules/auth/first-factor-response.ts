import type { AuthSession, TwoFactorChallenge } from '@classloom/contracts';
import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { Env } from '../../core/config/env.schema';
import { deviceTokenOf, setDeviceCookie } from './device-cookie';
import { readSessionToken, setSessionCookie } from './session-cookie';
import type { DeviceSignInMeta, FirstFactorOutcome } from './two-factor-sign-in.service';

/** What `completeFirstFactor` needs from the request, with the browser's device token. */
export function deviceSignInMeta(req: Request, env: Env): DeviceSignInMeta {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    currentToken: readSessionToken(req, env),
    deviceToken: deviceTokenOf(req, env),
  };
}

/**
 * The device cookie is set on every first-factor success; the session cookie only when a session
 * was made. A pending two-step sign-in answers 202 with the challenge.
 */
export function respondToFirstFactor(
  outcome: FirstFactorOutcome,
  deviceToken: string,
  res: Response,
  env: Env,
): AuthSession | TwoFactorChallenge {
  if (outcome.kind === 'challenge') {
    setDeviceCookie(res, env, deviceToken);
    res.status(HttpStatus.ACCEPTED);
    return outcome.body;
  }
  // Session cookie first, as before the device cookie existed.
  setSessionCookie(res, env, outcome.token, outcome.remember);
  setDeviceCookie(res, env, deviceToken);
  return outcome.session;
}
