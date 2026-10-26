import type { PrismaClient } from '../../generated/prisma/client';
import { TenantReassignmentError } from './errors';
import type { TenantContext } from './tenant-context';
import { isTenantScopedModel } from './tenant-scoped-models';

type Args = Record<string, unknown>;

/** Operations whose `data` (or `update`, for upsert) must not move rows between tenants. */
const UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

function assertNoTenantChange(data: unknown, operation: string): void {
  if (typeof data !== 'object' || data === null) return;
  if (Object.hasOwn(data, 'tenantId') || Object.hasOwn(data, 'tenant')) {
    throw new TenantReassignmentError(operation);
  }
}

/** Operations whose `where` is narrowed to the current tenant. */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Operations whose `data` gets the current tenant. */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

function withTenantId(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((row: Args) => ({ ...row, tenantId }));
  return { ...(data as Args | undefined), tenantId };
}

/**
 * Rewrites the arguments of a query on a tenant-scoped model so it can only touch the current
 * tenant's rows. A caller-supplied `tenantId` in `where` or create `data` is overwritten, never
 * trusted; one in update `data` (or upsert `update`) throws TenantReassignmentError, because rows
 * never move between tenants. Unknown operations throw rather than run unscoped.
 */
export function scopeArgs(operation: string, args: Args | undefined, tenantId: string): Args {
  const scoped: Args = { ...args };
  if (UPDATE_OPERATIONS.has(operation)) assertNoTenantChange(scoped.data, operation);
  if (operation === 'upsert') assertNoTenantChange(scoped.update, operation);
  if (WHERE_OPERATIONS.has(operation)) {
    scoped.where = { ...(scoped.where as Args | undefined), tenantId };
    if (operation === 'upsert') scoped.create = withTenantId(scoped.create, tenantId);
    return scoped;
  }
  if (CREATE_OPERATIONS.has(operation)) {
    scoped.data = withTenantId(scoped.data, tenantId);
    return scoped;
  }
  throw new Error(`Tenant scoping does not support operation "${operation}"`);
}

/**
 * Returns a client whose queries on tenant-scoped models (TENANT_SCOPED_MODELS) are:
 * 1. narrowed to the tenant in `context` (throws TenantContextMissingError without one), and
 * 2. run in a batch transaction after `set_config('app.tenant_id', id, true)`, so Postgres
 *    row-level security enforces the same boundary and the setting dies with the transaction.
 * Other models pass through unchanged.
 */
export function createTenantScopedClient(base: PrismaClient, context: TenantContext) {
  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantScopedModel(model)) return query(args);
          const tenantId = context.require();
          const scopedArgs = scopeArgs(operation, args, tenantId);
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
            query(scopedArgs as typeof args),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantScopedPrismaClient = ReturnType<typeof createTenantScopedClient>;
