import os from 'node:os';

import { normaliseSchoolCode, validateSchoolCode } from '@classloom/utils';
import type { INestApplicationContext } from '@nestjs/common';
import { Command } from 'commander';

import { PlatformPrismaService } from '../core/prisma/platform-prisma.service';
import { Prisma, TenantStatus } from '../generated/prisma/client';

const STATUSES = Object.values(TenantStatus);

/**
 * Builds the platform owner CLI. Commands run on the owner-role client, which bypasses
 * row-level security. Errors are thrown (never `process.exit`); `cli.ts` turns them into an
 * exit code.
 */
export function buildCli(app: INestApplicationContext, out: (line: string) => void): Command {
  const platform = app.get(PlatformPrismaService);
  const program = new Command().name('classloom').exitOverride();

  const audit = (entry: Record<string, string | undefined>): void =>
    out(JSON.stringify({ ...entry, by: os.userInfo().username }));

  async function find(raw: string) {
    const code = normaliseSchoolCode(raw);
    const tenant = await platform.tenant.findUnique({ where: { code } });
    if (!tenant) throw new Error(`School ${code} not found`);
    return tenant;
  }

  program
    .command('schools:list')
    .description('List schools')
    .option('--status <status>', `filter by status (${STATUSES.join(', ')})`)
    .action(async (opts: { status?: string }) => {
      const status = opts.status?.toUpperCase();
      if (status && !STATUSES.includes(status as TenantStatus)) {
        throw new Error(`Unknown status ${opts.status}; expected one of ${STATUSES.join(', ')}`);
      }
      const tenants = await platform.tenant.findMany({
        where: status ? { status: status as TenantStatus } : {},
        orderBy: { createdAt: 'asc' },
        include: {
          memberships: { where: { role: 'OWNER' }, include: { user: { select: { email: true } } } },
        },
      });
      for (const t of tenants) {
        const owner = t.memberships[0]?.user.email ?? '-';
        out([t.code.toUpperCase(), t.status, t.name, owner, t.createdAt.toISOString()].join('\t'));
      }
    });

  program
    .command('schools:suspend')
    .description('Suspend an active school')
    .argument('<code>')
    .requiredOption('--reason <text>', 'why the school is being suspended')
    .action(async (raw: string, opts: { reason: string }) => {
      const tenant = await find(raw);
      if (tenant.status !== 'ACTIVE') {
        throw new Error(`School ${tenant.code.toUpperCase()} is ${tenant.status}, not ACTIVE`);
      }
      await platform.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });
      audit({
        action: 'suspend',
        code: tenant.code.toUpperCase(),
        before: tenant.status,
        after: 'SUSPENDED',
        reason: opts.reason,
      });
    });

  program
    .command('schools:activate')
    .description('Reactivate a suspended school')
    .argument('<code>')
    .action(async (raw: string) => {
      const tenant = await find(raw);
      if (tenant.status !== 'SUSPENDED') {
        throw new Error(`School ${tenant.code.toUpperCase()} is ${tenant.status}, not SUSPENDED`);
      }
      await platform.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', suspendedAt: null },
      });
      audit({
        action: 'activate',
        code: tenant.code.toUpperCase(),
        before: tenant.status,
        after: 'ACTIVE',
      });
    });

  program
    .command('schools:rename-code')
    .description('Change a school code')
    .argument('<old>')
    .argument('<new>')
    .action(async (oldRaw: string, newRaw: string) => {
      const tenant = await find(oldRaw);
      const check = validateSchoolCode(newRaw);
      if (!check.ok) throw new Error(`School code ${check.code} is ${check.problem}`);
      try {
        await platform.tenant.update({ where: { id: tenant.id }, data: { code: check.code } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new Error(`School code ${check.code} is already taken`, { cause: error });
        }
        throw error;
      }
      audit({
        action: 'rename-code',
        code: check.code,
        before: tenant.code.toUpperCase(),
        after: check.code,
      });
    });

  return program;
}
