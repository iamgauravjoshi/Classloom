import type { Prisma } from '../../generated/prisma/client';
import { AcademicsLimitException } from './academics-problems';

/** The most of each kind a school can have, counting archived ones (academics spec section 4). */
export const ACADEMICS_LIMITS = {
  subjects: 200,
  streams: 20,
  houses: 20,
  rooms: 500,
  /** Per academic year and campus. */
  sections: 500,
} as const;

export type AcademicsLimitKind = keyof typeof ACADEMICS_LIMITS;

/** Narrows a section count to one year and campus. `adding` is how many rows the write adds. */
export interface LimitExtra {
  academicYearId?: string;
  campusId?: string;
  adding?: number;
}

/**
 * The academics limits. `assertBelow` serialises the school's writes of one kind (a
 * transaction-scoped advisory lock, Part 4's pattern) and then counts, so two concurrent creates
 * cannot both pass at the limit. Call it inside the write's `withTenant` transaction, before the
 * insert.
 */
export const AcademicsLimits = {
  /**
   * Takes the school's lock for writes of `kind` (for sections, of one year and campus) until the
   * transaction ends. Re-entrant: `assertBelow` takes it again. Callers that first read what
   * exists (e.g. the starter lists) take it before reading.
   */
  async lock(
    tx: Prisma.TransactionClient,
    kind: AcademicsLimitKind,
    tenantId: string,
    extra: LimitExtra = {},
  ): Promise<void> {
    const scope =
      kind === 'sections' ? `:${extra.academicYearId ?? ''}:${extra.campusId ?? ''}` : '';
    const key = `academics:${kind}:${tenantId}${scope}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  },

  /** Throws 409 `academics-limit` unless `adding` (default 1) more rows of `kind` fit. */
  async assertBelow(
    tx: Prisma.TransactionClient,
    kind: AcademicsLimitKind,
    tenantId: string,
    extra: LimitExtra = {},
  ): Promise<void> {
    await AcademicsLimits.lock(tx, kind, tenantId, extra);
    const count = await countOf(tx, kind, tenantId, extra);
    if (count + (extra.adding ?? 1) > ACADEMICS_LIMITS[kind]) {
      throw new AcademicsLimitException(ACADEMICS_LIMITS[kind]);
    }
  },
};

function countOf(
  tx: Prisma.TransactionClient,
  kind: AcademicsLimitKind,
  tenantId: string,
  extra: LimitExtra,
): Promise<number> {
  switch (kind) {
    case 'subjects':
      return tx.subject.count({ where: { tenantId } });
    case 'streams':
      return tx.stream.count({ where: { tenantId } });
    case 'houses':
      return tx.house.count({ where: { tenantId } });
    case 'rooms':
      return tx.room.count({ where: { tenantId } });
    case 'sections':
      return tx.section.count({
        where: {
          tenantId,
          ...(extra.academicYearId ? { academicYearId: extra.academicYearId } : {}),
          ...(extra.campusId ? { campusId: extra.campusId } : {}),
        },
      });
  }
}
