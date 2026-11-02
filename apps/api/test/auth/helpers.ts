import type { PrismaClient } from '../../src/generated/prisma/client';
import { PasswordService } from '../../src/modules/auth/password.service';

const passwords = new PasswordService();

/**
 * Creates an ACTIVE school with its primary campus, a user and their OWNER membership. Pass the
 * owner-role client from `ownerPrisma(env)`: it seeds across tenants, bypassing row-level security.
 */
export async function seedSchool(
  prisma: PrismaClient,
  input: { code: string; email: string; mobile?: string; password?: string },
): Promise<{ tenantId: string; userId: string; membershipId: string }> {
  const passwordHash = input.password ? await passwords.hash(input.password) : null;
  const now = new Date();
  const tenant = await prisma.tenant.create({
    data: {
      code: input.code,
      name: `School ${input.code}`,
      board: 'CBSE',
      city: 'Dehradun',
      state: 'UK',
      contactEmail: input.email,
      status: 'ACTIVE',
      verifiedAt: now,
      termsAcceptedAt: now,
      campuses: {
        create: { name: `School ${input.code}`, isPrimary: true, city: 'Dehradun', state: 'UK' },
      },
    },
  });
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: `Owner ${input.code}`,
      mobile: input.mobile ?? null,
      emailVerifiedAt: now,
      passwordHash,
      passwordChangedAt: passwordHash ? now : null,
    },
  });
  await prisma.$executeRaw`SELECT seed_builtin_roles(${tenant.id}::uuid)`;
  // Owner requires two-step by default, which would limit every seeded owner (they have none) to
  // the setup routes. Tests of the requirement itself switch it back on.
  await prisma.role.updateMany({
    where: { tenantId: tenant.id, key: 'OWNER' },
    data: { requiresTwoFactor: false },
  });
  const membership = await addMember(prisma, tenant.id, user.id);
  return { tenantId: tenant.id, userId: user.id, membershipId: membership.id };
}

/**
 * Creates a membership in a school seeded with the built-in roles and gives it a built-in role
 * (Owner by default). Pass the owner-role client from `ownerPrisma(env)`.
 */
export async function addMember(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  roleKey = 'OWNER',
): Promise<{ id: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId, key: roleKey } });
  const membership = await prisma.membership.create({ data: { tenantId, userId } });
  await prisma.membershipRole.create({
    data: { tenantId, membershipId: membership.id, roleId: role.id },
  });
  return { id: membership.id };
}
