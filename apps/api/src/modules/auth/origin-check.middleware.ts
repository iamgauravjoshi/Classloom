import { ForbiddenException, Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { readSessionToken } from './session-cookie';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Second layer after `SameSite=Lax`: a state-changing request that carries the session cookie
 * must come from the web app. Requests without the cookie (sign-in, registration) are not
 * affected, as they have no ambient credential to abuse.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  private readonly allowed: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.allowed = new URL(env.WEB_ORIGIN).origin;
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    if (
      UNSAFE_METHODS.has(req.method) &&
      readSessionToken(req, this.env) !== undefined &&
      req.headers.origin !== this.allowed
    ) {
      throw new ForbiddenException('Cross-site request refused');
    }
    next();
  }
}
