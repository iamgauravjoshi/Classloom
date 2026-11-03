import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Prisma } from '../../generated/prisma/client';
import { PLATFORM_MODELS_WITH_TENANT_FK, TENANT_SCOPED_MODELS } from './tenant-scoped-models';

// The `prisma-client` generator does not expose `Prisma.dmmf`, so the schema files are the source.
const schemaDir = path.resolve(__dirname, '../../../prisma/schema');

function modelsWithTenantId(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(schemaDir).filter((f) => f.endsWith('.prisma'))) {
    const source = readFileSync(path.join(schemaDir, file), 'utf8');
    for (const match of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const [, name, body] = match;
      if (name && body && /^\s*tenantId\s/m.test(body)) found.push(name);
    }
  }
  return found.sort();
}

describe('TENANT_SCOPED_MODELS', () => {
  it('finds tenant-owned models in the schema (the parser is not vacuous)', () => {
    expect(modelsWithTenantId()).toEqual(expect.arrayContaining(['Campus', 'Membership']));
  });

  it('scopes every IAM table (spec section 6: all are row-level secured)', () => {
    for (const model of ['Role', 'RolePermission', 'MembershipRole', 'Invitation', 'AuditEvent']) {
      expect((TENANT_SCOPED_MODELS as ReadonlySet<string>).has(model)).toBe(true);
    }
  });

  it('scopes every onboarding table (Part 4 spec section 4: all are row-level secured)', () => {
    for (const model of ['SchoolProfile', 'File', 'AcademicYear', 'AcademicTerm']) {
      expect((TENANT_SCOPED_MODELS as ReadonlySet<string>).has(model)).toBe(true);
    }
  });

  it('lists every model with a tenantId field, unless it is an explicit platform exemption', () => {
    const missing = modelsWithTenantId().filter(
      (m) =>
        !(TENANT_SCOPED_MODELS as ReadonlySet<string>).has(m) &&
        !(PLATFORM_MODELS_WITH_TENANT_FK as ReadonlySet<string>).has(m),
    );
    expect(missing).toEqual([]);
  });

  it('only lists real Prisma models that declare tenantId', () => {
    const withTenantId = modelsWithTenantId();
    const all = [...TENANT_SCOPED_MODELS, ...PLATFORM_MODELS_WITH_TENANT_FK];
    for (const model of all) {
      expect(Object.values(Prisma.ModelName)).toContain(model);
      expect(withTenantId).toContain(model);
    }
  });

  it('never both scopes and exempts a model', () => {
    for (const model of PLATFORM_MODELS_WITH_TENANT_FK) {
      expect((TENANT_SCOPED_MODELS as ReadonlySet<string>).has(model)).toBe(false);
    }
  });
});
