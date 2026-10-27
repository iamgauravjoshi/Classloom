import type { MembershipRole } from '../../generated/prisma/client';

/** Who is calling, resolved from the session cookie by `SessionMiddleware`. */
export interface RequestAuth {
  sessionId: string;
  userId: string;
  tenantId: string;
  membershipId: string;
  role: Extract<MembershipRole, 'OWNER'>;
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
