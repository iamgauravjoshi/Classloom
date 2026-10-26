/**
 * Thrown when code touches tenant-owned data without a tenant in context. It is a server bug
 * (surfaces as a 500 and is logged); the query never falls back to "all tenants".
 */
export class TenantContextMissingError extends Error {
  constructor(message = 'No tenant in context for a tenant-scoped operation') {
    super(message);
    this.name = 'TenantContextMissingError';
  }
}

/**
 * Thrown when a scoped update tries to set `tenantId` or the `tenant` relation. Rows never move
 * between tenants through the scoped client; a caller attempting it has a bug.
 */
export class TenantReassignmentError extends Error {
  constructor(operation: string) {
    super(`${operation} may not change tenantId or tenant on a tenant-scoped row`);
    this.name = 'TenantReassignmentError';
  }
}
