import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../core/prisma/prisma.service';
import { SchoolCodeService } from './school-code.service';

function serviceWithTaken(taken: string[]): SchoolCodeService {
  const prisma = {
    tenant: {
      findMany: vi.fn(({ where }: { where: { code: { in: string[] } } }) =>
        Promise.resolve(where.code.in.filter((c) => taken.includes(c)).map((code) => ({ code }))),
      ),
    },
  };
  return new SchoolCodeService(prisma as unknown as PrismaService);
}

describe('SchoolCodeService.nextFreeCode', () => {
  it('returns the base when free', async () => {
    expect(await serviceWithTaken([]).nextFreeCode('GISD')).toBe('GISD');
  });

  it('appends the first free numeric suffix', async () => {
    expect(await serviceWithTaken(['GISD', 'GISD-2']).nextFreeCode('GISD')).toBe('GISD-3');
  });

  it('falls back to a random 3-digit suffix after 20 tries', async () => {
    const taken = ['GISD', ...Array.from({ length: 19 }, (_, i) => `GISD-${i + 2}`)];
    expect(await serviceWithTaken(taken).nextFreeCode('GISD')).toMatch(/^GISD-\d{3}$/);
  });

  it('keeps suggestions within 12 characters', async () => {
    const code = await serviceWithTaken(['ABCDEFGHIJKL']).nextFreeCode('ABCDEFGHIJKL');
    expect(code.length).toBeLessThanOrEqual(12);
    expect(code).toMatch(/-2$/);
  });
});
