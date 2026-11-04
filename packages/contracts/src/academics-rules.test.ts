import { describe, expect, it } from 'vitest';

import {
  checkClassSubjectRows,
  classesInRange,
  isInRange,
  isSeniorClass,
  planCopyForward,
  sectionLabel,
} from './academics-rules';

describe('class range', () => {
  it('knows senior classes', () => {
    expect(isSeniorClass('XI')).toBe(true);
    expect(isSeniorClass('XII')).toBe(true);
    expect(isSeniorClass('X')).toBe(false);
  });
  it('lists classes in range', () => {
    expect(classesInRange('UKG', 'II')).toEqual(['UKG', 'I', 'II']);
    expect(classesInRange(null, 'X')).toEqual([]);
    expect(classesInRange('V', null)).toEqual([]);
  });
  it('checks membership of the range', () => {
    expect(isInRange('V', 'I', 'X')).toBe(true);
    expect(isInRange('XI', 'I', 'X')).toBe(false);
    expect(isInRange('V', null, 'X')).toBe(false);
  });
});

describe('checkClassSubjectRows', () => {
  it('rejects a stream on a junior class', () => {
    expect(
      checkClassSubjectRows('VI', [{ subjectId: 's1', streamId: 't1', kind: 'COMPULSORY' }]),
    ).toEqual({ ok: false, index: 0, problem: 'stream-not-allowed' });
  });
  it('rejects the same subject twice under one stream', () => {
    const rows = [
      { subjectId: 's1', streamId: 't1', kind: 'COMPULSORY' as const },
      { subjectId: 's1', streamId: 't1', kind: 'OPTIONAL' as const },
    ];
    expect(checkClassSubjectRows('XI', rows)).toEqual({
      ok: false,
      index: 1,
      problem: 'duplicate',
    });
  });
  it('allows the same subject under null and under a stream', () => {
    const rows = [
      { subjectId: 's1', streamId: null, kind: 'COMPULSORY' as const },
      { subjectId: 's1', streamId: 't1', kind: 'OPTIONAL' as const },
    ];
    expect(checkClassSubjectRows('XI', rows)).toEqual({ ok: true });
  });
});

describe('planCopyForward', () => {
  const ctx = () => ({
    activeRoomIds: new Set(['r1']),
    activeMemberIds: new Set(['m1', 'm2', 'm3']),
    takenTeacherIds: new Set<string>(),
    activeStreamIds: new Set(['st1']),
  });
  const src = (o: object) => ({
    campusId: 'c1',
    classLevel: 'XI' as const,
    name: 'A',
    capacity: 30,
    streamId: null,
    roomId: null,
    classTeacherMembershipId: null,
    ...o,
  });
  it('keeps what still qualifies', () => {
    const r = planCopyForward(
      [src({ streamId: 'st1', roomId: 'r1', classTeacherMembershipId: 'm1' })],
      ctx(),
    );
    expect(r.dropped).toEqual([]);
    expect(r.create[0]).toMatchObject({
      streamId: 'st1',
      roomId: 'r1',
      classTeacherMembershipId: 'm1',
    });
  });
  it('drops archived room, inactive teacher, taken teacher and archived stream', () => {
    const c = ctx();
    c.takenTeacherIds.add('m2');
    const r = planCopyForward(
      [
        src({ name: 'A', roomId: 'r9', streamId: 'st9', classTeacherMembershipId: 'm1' }),
        src({ name: 'B', classTeacherMembershipId: 'zz' }),
        src({ name: 'C', classTeacherMembershipId: 'm2' }),
      ],
      c,
    );
    expect(r.dropped).toEqual([
      { section: 'XI-A', field: 'room' },
      { section: 'XI-A', field: 'stream' },
      { section: 'XI-B', field: 'teacher' },
      { section: 'XI-C', field: 'teacher' },
    ]);
    expect(r.create.map((x) => x.classTeacherMembershipId)).toEqual(['m1', null, null]);
    expect(r.create[0]).toMatchObject({ roomId: null, streamId: null });
  });
  it('keeps a teacher only on the first of two sections', () => {
    const r = planCopyForward(
      [
        src({ name: 'A', classTeacherMembershipId: 'm3' }),
        src({ name: 'B', classTeacherMembershipId: 'm3' }),
      ],
      ctx(),
    );
    expect(r.create.map((x) => x.classTeacherMembershipId)).toEqual(['m3', null]);
    expect(r.dropped).toEqual([{ section: 'XI-B', field: 'teacher' }]);
  });
});

describe('sectionLabel', () => {
  it('joins the class and the section name with a hyphen', () => {
    expect(sectionLabel('VI', 'A')).toBe('VI-A');
  });
});
