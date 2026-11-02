import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { MEMBER_ROLES_SELECT, toMemberAccess } from '../iam/permissions';
import { SessionService } from './session.service';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie';

/**
 * `X-Session-Touch: skip` validates the session without sliding it (no `last_seen_at` update, no
 * cookie refresh). The web server sends it on its own `GET /auth/session`, whose `Set-Cookie` would
 * never reach the browser; the browser's own call through `/api` does the sliding. A client sending
 * it gains nothing: its session only stops sliding.
 */
export const SESSION_TOUCH_HEADER = 'x-session-touch';

/**
 * Runs before guards. A valid cookie attaches `request.auth`, with the member's roles and
 * permissions loaded afresh on every request (spec §7), and runs the rest of the request
 * inside the session school's tenant context. Anything invalid is anonymous and clears the cookie.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = readSessionToken(req, this.env);
      if (!token) return next();

      const resolved = await this.sessions.resolve(token);
      const membership = resolved
        ? await this.tenantContext.run(resolved.tenant.id, () =>
            this.prisma.scoped.membership.findFirst({
              where: {
                id: resolved.session.membershipId,
                userId: resolved.session.userId,
                status: 'ACTIVE',
              },
              // The roles come in the same query, under the same tenant context and RLS.
              select: { id: true, roles: MEMBER_ROLES_SELECT },
            }),
          )
        : null;
      if (!resolved || !membership) {
        clearSessionCookie(res, this.env);
        return next();
      }

      const { session } = resolved;
      if (req.headers[SESSION_TOUCH_HEADER] !== 'skip') {
        const { cookieRefresh } = await this.sessions.touch(session);
        if (cookieRefresh) setSessionCookie(res, this.env, token, session.remember);
      }

      const { roles, permissions, isOwner } = toMemberAccess(membership.roles);
      req.auth = {
        sessionId: session.id,
        userId: session.userId,
        tenantId: session.tenantId,
        membershipId: session.membershipId,
        roles,
        permissions,
        isOwner,
        twoFactorSetupRequired: false,
        remember: session.remember,
        authenticatedAt: session.authenticatedAt,
      };
      // Express runs the rest of the chain synchronously from next(), so it stays in the context.
      this.tenantContext.run(session.tenantId, () => next());
    } catch (error) {
      next(error);
    }
  }
}
