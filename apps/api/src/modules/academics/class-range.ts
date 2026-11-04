import { type ClassLevel, isInRange } from '@classloom/contracts';

import type { Prisma } from '../../generated/prisma/client';
import { ClassesNotSetException, ClassOutOfRangeException } from './academics-problems';

/** The school profile's class range; both ends are null until the school sets it. */
export interface ClassRangeValue {
  lowest: ClassLevel | null;
  highest: ClassLevel | null;
}

/** The profile class range (academics spec section 3, "The profile range"). */
export const ClassRange = {
  /** The school's `lowest_class`-`highest_class`, or nulls when there is no profile or range. */
  async load(tx: Prisma.TransactionClient, tenantId: string): Promise<ClassRangeValue> {
    const profile = await tx.schoolProfile.findUnique({
      where: { tenantId },
      select: { lowestClass: true, highestClass: true },
    });
    if (!profile?.lowestClass || !profile.highestClass) return { lowest: null, highest: null };
    return { lowest: profile.lowestClass, highest: profile.highestClass };
  },

  /**
   * Throws unless `level` can be written: 409 `classes-not-set` without a range, 422
   * `class-out-of-range` outside it.
   */
  assertWritable(range: ClassRangeValue, level: ClassLevel): void {
    if (range.lowest === null || range.highest === null) throw new ClassesNotSetException();
    if (!isInRange(level, range.lowest, range.highest)) throw new ClassOutOfRangeException();
  },
};
