import { type ClassSubjectRow, SENIOR_CLASSES } from './academics';
import { CLASS_LEVELS, type ClassLevel } from './school';

export function isSeniorClass(level: ClassLevel): boolean {
  return (SENIOR_CLASSES as readonly string[]).includes(level);
}

/** Every class from `lowest` to `highest`, in order; empty when the range is not set. */
export function classesInRange(
  lowest: ClassLevel | null,
  highest: ClassLevel | null,
): ClassLevel[] {
  if (lowest === null || highest === null) return [];
  return CLASS_LEVELS.slice(CLASS_LEVELS.indexOf(lowest), CLASS_LEVELS.indexOf(highest) + 1);
}

export function isInRange(
  level: ClassLevel,
  lowest: ClassLevel | null,
  highest: ClassLevel | null,
): boolean {
  return classesInRange(lowest, highest).includes(level);
}

export type ClassSubjectCheck =
  { ok: true } | { ok: false; index: number; problem: 'stream-not-allowed' | 'duplicate' };

/** Stream rows belong to senior classes only; (subject, stream) pairs are unique. */
export function checkClassSubjectRows(
  level: ClassLevel,
  rows: readonly ClassSubjectRow[],
): ClassSubjectCheck {
  const senior = isSeniorClass(level);
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (row.streamId !== null && !senior)
      return { ok: false, index, problem: 'stream-not-allowed' };
    const key = `${row.subjectId}|${row.streamId ?? ''}`;
    if (seen.has(key)) return { ok: false, index, problem: 'duplicate' };
    seen.add(key);
  }
  return { ok: true };
}

export type CopySource = {
  campusId: string;
  classLevel: ClassLevel;
  name: string;
  capacity: number;
  streamId: string | null;
  roomId: string | null;
  classTeacherMembershipId: string | null;
};
export type CopyRow = CopySource;

/**
 * What copy-forward left out of a section: its room, teacher or stream (set to null), or the
 * whole section (`class`: its class is outside the profile range).
 */
export type CopyDropped = { section: string; field: 'room' | 'teacher' | 'stream' | 'class' };

/** A section's class-qualified label, e.g. "VI-A". */
export function sectionLabel(level: ClassLevel, name: string): string {
  return `${level}-${name}`;
}

/**
 * Plans the sections to create in a new year from the previous one. A room, teacher or stream
 * that no longer qualifies is dropped (set to null) and reported. A teacher stays only on the
 * first copied row that names them (source order is class order).
 */
export function planCopyForward(
  source: readonly CopySource[],
  ctx: {
    activeRoomIds: Set<string>;
    activeMemberIds: Set<string>;
    takenTeacherIds: Set<string>;
    activeStreamIds: Set<string>;
  },
): { create: CopyRow[]; dropped: CopyDropped[] } {
  const used = new Set(ctx.takenTeacherIds);
  const create: CopyRow[] = [];
  const dropped: CopyDropped[] = [];
  for (const s of source) {
    const label = sectionLabel(s.classLevel, s.name);
    const row: CopyRow = { ...s };
    if (s.roomId !== null && !ctx.activeRoomIds.has(s.roomId)) {
      row.roomId = null;
      dropped.push({ section: label, field: 'room' });
    }
    if (s.classTeacherMembershipId !== null) {
      const t = s.classTeacherMembershipId;
      if (ctx.activeMemberIds.has(t) && !used.has(t)) used.add(t);
      else {
        row.classTeacherMembershipId = null;
        dropped.push({ section: label, field: 'teacher' });
      }
    }
    if (s.streamId !== null && !ctx.activeStreamIds.has(s.streamId)) {
      row.streamId = null;
      dropped.push({ section: label, field: 'stream' });
    }
    create.push(row);
  }
  return { create, dropped };
}
