/**
 * Tenant-owned models. The scoped Prisma client injects `tenantId` into every query on these,
 * and each has a forced row-level security policy in its migration. A unit test fails if a
 * model with a `tenantId` field is in neither this set nor PLATFORM_MODELS_WITH_TENANT_FK.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<'Campus' | 'Membership'> = new Set([
  'Campus',
  'Membership',
] as const);

export type TenantScopedModel =
  typeof TENANT_SCOPED_MODELS extends ReadonlySet<infer M> ? M : never;

/**
 * Platform-level models that reference a tenant but are deliberately not tenant-scoped (spec
 * section 5): they are read before any tenant context exists. Adding a model here needs the
 * same review as removing a row-level security policy.
 */
export const PLATFORM_MODELS_WITH_TENANT_FK: ReadonlySet<'RegistrationToken'> = new Set([
  'RegistrationToken',
] as const);

export function isTenantScopedModel(model: string | undefined): model is TenantScopedModel {
  return model !== undefined && (TENANT_SCOPED_MODELS as ReadonlySet<string>).has(model);
}
