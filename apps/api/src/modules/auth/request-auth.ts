/** Who is calling, resolved from the session cookie by `SessionMiddleware`. */
export interface RequestAuth {
  sessionId: string;
  userId: string;
  tenantId: string;
  membershipId: string;
  // IAM: replaced in Task 3 (roles, permissions, isOwner). Every active member is an owner until then.
  role: 'OWNER';
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
