import { type HttpException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

import { dbViolation, uniqueViolationProblem } from '../../core/prisma/constraint-problem';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestAuth } from '../auth/request-auth';
import { InUseException, NameTakenException, TeacherTakenException } from './academics-problems';

/** The member making the change, or the platform CLI (no user). */
export type Actor = Pick<RequestAuth, 'tenantId'> & { userId: string | null };

/** Where the request came from, for the audit row. */
export interface AuditMeta {
  ip?: string;
  userAgent?: string;
}

/** The audit meta of a request. */
export const auditMeta = (req: Request): AuditMeta => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route id that cannot be a row id (not a UUID) is simply not found. */
export const isUuid = (id: string): boolean => UUID.test(id);

/** The 404 for a missing row of the current school (row-level security hides other schools'). */
export const notFound = (what: string) => new NotFoundException(`${what} not found`);

/**
 * The case-insensitive unique name indexes of the academics tables and the request field each
 * guards (see the academics migration). A 23505 on one of them is 409 `name-taken`.
 */
const NAME_INDEXES = [
  'streams_name_key',
  'subjects_name_key',
  'houses_name_key',
  'rooms_name_key',
  'sections_name_key',
] as const;
const NAME_PROBLEMS = NAME_INDEXES.map(
  (index) => [index, () => new NameTakenException('name')] as const,
);

/**
 * The unique indexes a 23505 maps to a problem: the name indexes, and the one-section-per-teacher
 * index (`sections_class_teacher_key`), a backstop behind the sections service's own check under
 * its lock; the section's name is not known here, so the problem goes without it.
 */
const UNIQUE_PROBLEMS = [
  ...NAME_PROBLEMS,
  ['sections_class_teacher_key', () => new TeacherTakenException()] as const,
];

/**
 * One `withTenant` transaction for an academics write. A unique-name violation becomes 409
 * `name-taken` (`field: 'name'`), and a unique class-teacher one 409 `teacher-taken`. A foreign key
 * violation becomes `foreignKeyProblem()` when given (e.g. a 422 for a row deleted between a check
 * and an insert); with `inUseOnForeignKey`, it (a row still referenced, NO ACTION) becomes 409
 * `in-use`.
 */
export async function academicsWrite<T>(
  prisma: PrismaService,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { inUseOnForeignKey?: boolean; foreignKeyProblem?: () => HttpException } = {},
): Promise<T> {
  try {
    return await withTenant(prisma, tenantId, fn);
  } catch (error) {
    const named = uniqueViolationProblem(error, UNIQUE_PROBLEMS);
    if (named) throw named;
    if (dbViolation(error)?.sqlState === '23503') {
      if (options.foreignKeyProblem) throw options.foreignKeyProblem();
      if (options.inUseOnForeignKey) throw new InUseException({});
    }
    throw error;
  }
}

/** Audit `before`/`after` fields. */
export type JsonFields = Record<string, Prisma.InputJsonValue | null>;

/** Keeps only the fields whose value changes, as `before` and `after` for the audit row. */
export function changedFields<K extends string>(
  keys: readonly K[],
  current: Record<K, Prisma.InputJsonValue | null>,
  input: Partial<Record<K, Prisma.InputJsonValue | null>>,
): { before: JsonFields; after: JsonFields } {
  const before: JsonFields = {};
  const after: JsonFields = {};
  for (const key of keys) {
    const next = input[key];
    if (next !== undefined && next !== current[key]) {
      before[key] = current[key];
      after[key] = next;
    }
  }
  return { before, after };
}
