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
