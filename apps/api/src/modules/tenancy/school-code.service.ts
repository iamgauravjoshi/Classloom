import type { CodeAvailabilityQuery, CodeAvailabilityResponse } from '@classloom/contracts';
import { suggestSchoolCode, validateSchoolCode } from '@classloom/utils';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';

const MAX_CODE_LENGTH = 12;
const MAX_SEQUENTIAL_TRIES = 20;

@Injectable()
export class SchoolCodeService {
  constructor(private readonly prisma: PrismaService) {}

  async checkAvailability(query: CodeAvailabilityQuery): Promise<CodeAvailabilityResponse> {
    const suggestionBase = async (): Promise<string | undefined> =>
      query.name && query.city
        ? this.nextFreeCode(suggestSchoolCode(query.name, query.city))
        : undefined;

    if (query.code === undefined || query.code.trim() === '') {
      const suggestion = await suggestionBase();
      return { code: '', available: false, ...(suggestion && { suggestion }) };
    }

    const check = validateSchoolCode(query.code);
    if (!check.ok) {
      const suggestion = await suggestionBase();
      return {
        code: check.code,
        available: false,
        reason: check.problem,
        ...(suggestion && { suggestion }),
      };
    }

    const taken = await this.prisma.tenant.findFirst({
      where: { code: check.code },
      select: { id: true },
    });
    if (!taken) return { code: check.code, available: true };

    const suggestion = await suggestionBase();
    return {
      code: check.code,
      available: false,
      reason: 'taken',
      ...(suggestion && { suggestion }),
    };
  }

  /** First free of `base`, `base-2` … `base-20`, else `base-NNN` with a random 3-digit suffix. */
  async nextFreeCode(base: string): Promise<string> {
    const candidates = [base];
    for (let n = 2; n <= MAX_SEQUENTIAL_TRIES; n += 1) {
      candidates.push(this.withSuffix(base, `-${n}`));
    }
    const rows = await this.prisma.tenant.findMany({
      where: { code: { in: candidates } },
      select: { code: true },
    });
    const taken = new Set(rows.map((row) => row.code.toUpperCase()));
    const free = candidates.find((candidate) => !taken.has(candidate.toUpperCase()));
    if (free) return free;
    const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return this.withSuffix(base, `-${random}`);
  }

  private withSuffix(base: string, suffix: string): string {
    return `${base.slice(0, MAX_CODE_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
  }
}
