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
  const membership = await prisma.membership.create({
    data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' },
  });
  return { tenantId: tenant.id, userId: user.id, membershipId: membership.id };
}
