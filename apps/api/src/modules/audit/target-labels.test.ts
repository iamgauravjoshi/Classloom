import { describe, expect, it, vi } from 'vitest';

import type { Prisma } from '../../generated/prisma/client';
import { targetKey, TargetLabels } from './target-labels';

const ID = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** A fake transaction whose models answer `findMany` with `rows[model]`, recording each call. */
function fakeTx(rows: Record<string, unknown[]>, school: { id: string; name: string }[] = []) {
  const calls: { model: string; args: unknown }[] = [];
  const model = (name: string) => ({
    findMany: vi.fn((args: unknown) => {
      calls.push({ model: name, args });
      return Promise.resolve(rows[name] ?? []);
    }),
  });
  const tx = {
    role: model('role'),
    membership: model('membership'),
    invitation: model('invitation'),
    section: model('section'),
    stream: model('stream'),
    subject: model('subject'),
    house: model('house'),
    room: model('room'),
    academicYear: model('academicYear'),
    campus: model('campus'),
    $queryRaw: vi.fn(() => {
      calls.push({ model: 'tenant', args: null });
      return Promise.resolve(school);
    }),
  };
  return { tx: tx as unknown as Prisma.TransactionClient, calls };
}

describe('TargetLabels.resolve', () => {
  it('labels every kind of target with one query per type', async () => {
    const { tx, calls } = fakeTx(
      {
        role: [{ id: ID(1), name: 'Teacher' }],
        membership: [{ id: ID(2), user: { name: 'Asha Rao' } }],
        invitation: [{ id: ID(3), email: 'ravi.kumar@example.com' }],
        section: [{ id: ID(4), classLevel: 'VII', name: 'B' }],
        stream: [{ id: ID(5), name: 'Science' }],
        subject: [{ id: ID(6), name: 'Mathematics' }],
        house: [{ id: ID(7), name: 'Tagore' }],
        room: [{ id: ID(8), name: 'Lab 1' }],
        academicYear: [{ id: ID(9), label: '2026-27' }],
        campus: [{ id: ID(10), name: 'Main campus' }],
      },
      [{ id: ID(11), name: 'Doon Public School' }],
    );
    const labels = await TargetLabels.resolve(tx, [
      { type: 'role', id: ID(1) },
      { type: 'role', id: ID(1) },
      { type: 'membership', id: ID(2) },
      { type: 'invitation', id: ID(3) },
      { type: 'section', id: ID(4) },
      { type: 'stream', id: ID(5) },
      { type: 'subject', id: ID(6) },
      { type: 'house', id: ID(7) },
      { type: 'room', id: ID(8) },
      { type: 'academic_year', id: ID(9) },
      { type: 'campus', id: ID(10) },
      { type: 'school', id: ID(11) },
      { type: 'class_level', id: ID(11) },
      { type: 'number_series', id: ID(11) },
      { type: 'audit', id: ID(11) },
    ]);
    expect(Object.fromEntries(labels)).toEqual({
      [targetKey('role', ID(1))]: 'Teacher',
      [targetKey('membership', ID(2))]: 'Asha Rao',
      [targetKey('invitation', ID(3))]: expect.not.stringContaining('ravi.kumar') as string,
      [targetKey('section', ID(4))]: 'VII-B',
      [targetKey('stream', ID(5))]: 'Science',
      [targetKey('subject', ID(6))]: 'Mathematics',
      [targetKey('house', ID(7))]: 'Tagore',
      [targetKey('room', ID(8))]: 'Lab 1',
      [targetKey('academic_year', ID(9))]: '2026-27',
      [targetKey('campus', ID(10))]: 'Main campus',
      [targetKey('school', ID(11))]: 'Doon Public School',
      [targetKey('class_level', ID(11))]: null,
      [targetKey('number_series', ID(11))]: null,
      [targetKey('audit', ID(11))]: null,
    });
    expect(labels.get(targetKey('invitation', ID(3)))).toMatch(/@example\.com$/);
    // One query per looked-up type; none for the types whose sentences read `after`.
    expect(calls.map((c) => c.model).sort()).toEqual(
      [
        'academicYear',
        'campus',
        'house',
        'invitation',
        'membership',
        'role',
        'room',
        'section',
        'stream',
        'subject',
        'tenant',
      ].sort(),
    );
    expect(calls.find((c) => c.model === 'role')?.args).toMatchObject({
      where: { id: { in: [ID(1)] } },
    });
  });

  it('gives null for a target that is gone, and for a school other than this one', async () => {
    const { tx } = fakeTx({}, [{ id: ID(11), name: 'Doon Public School' }]);
    const labels = await TargetLabels.resolve(tx, [
      { type: 'role', id: ID(1) },
      { type: 'school', id: ID(12) },
    ]);
    expect(labels.get(targetKey('role', ID(1)))).toBeNull();
    expect(labels.get(targetKey('school', ID(12)))).toBeNull();
  });

  it('runs no query for no targets', async () => {
    const { tx, calls } = fakeTx({});
    expect((await TargetLabels.resolve(tx, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});
