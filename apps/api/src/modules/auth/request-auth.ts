import type { MemberRole } from '../iam/permissions';

/** Who is calling, resolved from the session cookie by `SessionMiddleware`. */
export interface RequestAuth {
  sessionId: string;
  userId: string;
  tenantId: string;
  membershipId: string;
  /** The member's roles, loaded on every request (ordered by name). */
  roles: MemberRole[];
  /** Effective permissions, computed on every request: a change applies to the next request. */
  permissions: ReadonlySet<string>;
  isOwner: boolean;
  /** The session must set up two-step sign-in before anything else (spec §10). */
  twoFactorSetupRequired: boolean;
  remember: boolean;
  authenticatedAt: Date;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the only way to extend Express's Request
  namespace Express {
    interface Request {
      auth?: RequestAuth;
    }
  }
}
