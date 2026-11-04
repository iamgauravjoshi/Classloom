import type { HttpException } from '@nestjs/common';

/** A Postgres constraint violation read from a Prisma error: its SQLSTATE and where to look for the name. */
export interface DbViolation {
  sqlState: string;
  /** Lower-cased `meta.target`, `meta.constraint` and the driver adapter's `constraint.index`. */
  named: string;
  /** Lower-cased error message and the driver's original message. */
  text: string;
}

/**
 * The SQLSTATE of a database error from Prisma 7 (with `@prisma/adapter-pg`), or null when the
 * error is not one: from the driver adapter's `originalCode`, `P2002` as `23505`, or the
 * `Code: \`…\`` in the message.
 */
export function dbViolation(error: unknown): DbViolation | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { code?: unknown; message?: unknown; meta?: Record<string, unknown> };
  const cause = (
    e.meta?.driverAdapterError as
      | {
          cause?: {
            originalCode?: unknown;
            originalMessage?: unknown;
            constraint?: { index?: unknown };
          };
        }
      | undefined
  )?.cause;
  const message = typeof e.message === 'string' ? e.message : '';
  const sqlState =
    typeof cause?.originalCode === 'string'
      ? cause.originalCode
      : e.code === 'P2002'
        ? '23505'
        : /Code: `(\w+)`/.exec(message)?.[1];
  if (!sqlState) return null;

  const named = [e.meta?.target, e.meta?.constraint, cause?.constraint?.index]
    .map((v) => JSON.stringify(v ?? '').toLowerCase())
    .join(' ');
  const original = typeof cause?.originalMessage === 'string' ? cause.originalMessage : '';
  return { sqlState, named, text: `${message} ${original}`.toLowerCase() };
}

/**
 * The problem for a unique violation (`23505`) of one of the named indexes, or null. The name is
 * matched first in the structured fields, then in the error message.
 */
export function uniqueViolationProblem(
  error: unknown,
  problems: readonly (readonly [index: string, problem: () => HttpException])[],
): HttpException | null {
  const violation = dbViolation(error);
  if (violation?.sqlState !== '23505') return null;
  for (const source of [violation.named, violation.text]) {
    const match = problems.find(([name]) => source.includes(name));
    if (match) return match[1]();
  }
  return null;
}
