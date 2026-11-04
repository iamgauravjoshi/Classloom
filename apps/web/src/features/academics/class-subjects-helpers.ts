import { ApiError } from '@classloom/api-client';
import {
  CLASS_LEVELS,
  classesInRange,
  type ClassLevel,
  type ClassSubjectKind,
  type ClassSubjectRow,
  type ClassSubjectsClass,
} from '@classloom/contracts';

import type { ClassRange } from './section-helpers';

/** A class subject row with its class, as the grid holds them. */
export interface LevelRow extends ClassSubjectRow {
  classLevel: ClassLevel;
}

/** Every cell of the grid that is set, by `cellKey`. A missing key is "not taught". */
export type CellMap = ReadonlyMap<string, ClassSubjectKind>;

/** The "All streams" row's key part: a null stream. */
const ALL = '*';

/** One cell: a class, a stream (null for all streams, and for a junior class) and a subject. */
export const cellKey = (level: ClassLevel, streamId: string | null, subjectId: string): string =>
  `${level}|${streamId ?? ALL}|${subjectId}`;

function parseKey(key: string): { level: ClassLevel; streamId: string | null; subjectId: string } {
  const [level, stream, subjectId] = key.split('|') as [ClassLevel, string, string];
  return { level, streamId: stream === ALL ? null : stream, subjectId };
}

/** The cells the rows set. */
export function toCellMap(rows: readonly LevelRow[]): Map<string, ClassSubjectKind> {
  return new Map(
    rows.map((row) => [cellKey(row.classLevel, row.streamId, row.subjectId), row.kind]),
  );
}

/** `GET /academics/class-subjects` flattened into rows that carry their class. */
export function classRowsOf(classes: readonly ClassSubjectsClass[]): LevelRow[] {
  return classes.flatMap((c) => c.rows.map((row) => ({ ...row, classLevel: c.classLevel })));
}

/**
 * One class's rows, as `PUT /academics/class-subjects/:classLevel` takes them: all-streams rows
 * first, then by subject and stream, so the same cells always give the same list.
 */
export function rowsForClass(map: CellMap, level: ClassLevel): ClassSubjectRow[] {
  const rows: ClassSubjectRow[] = [];
  for (const [key, kind] of map) {
    const cell = parseKey(key);
    if (cell.level === level)
      rows.push({ subjectId: cell.subjectId, streamId: cell.streamId, kind });
  }
  return rows.sort(
    (a, b) =>
      Number(a.streamId !== null) - Number(b.streamId !== null) ||
      a.subjectId.localeCompare(b.subjectId) ||
      (a.streamId ?? '').localeCompare(b.streamId ?? ''),
  );
}

/** Whether a class has the same rows in both maps. */
export function sameClassRows(a: CellMap, b: CellMap, level: ClassLevel): boolean {
  const left = rowsForClass(a, level);
  const right = rowsForClass(b, level);
  return (
    left.length === right.length &&
    left.every(
      (row, i) =>
        row.subjectId === right[i]!.subjectId &&
        row.streamId === right[i]!.streamId &&
        row.kind === right[i]!.kind,
    )
  );
}

/** A copy of `map` with one cell set, or cleared when `kind` is undefined. Other cells stay. */
export function withCell(
  map: CellMap,
  level: ClassLevel,
  streamId: string | null,
  subjectId: string,
  kind: ClassSubjectKind | undefined,
): Map<string, ClassSubjectKind> {
  const next = new Map(map);
  const key = cellKey(level, streamId, subjectId);
  if (kind === undefined) next.delete(key);
  else next.set(key, kind);
  return next;
}

/** A cell's next state: not taught, then compulsory, then optional, then not taught again. */
export function nextKind(kind: ClassSubjectKind | undefined): ClassSubjectKind | undefined {
  if (kind === undefined) return 'COMPULSORY';
  return kind === 'COMPULSORY' ? 'OPTIONAL' : undefined;
}

/** The grid's rows: every class in the profile range, then classes outside it that have rows. */
export function gridClasses(
  range: ClassRange,
  classes: readonly ClassSubjectsClass[],
): { classLevel: ClassLevel; outsideRange: boolean }[] {
  const inRange = new Set(classesInRange(range.lowest, range.highest));
  const withRows = new Set(classes.filter((c) => c.rows.length > 0).map((c) => c.classLevel));
  return [
    ...CLASS_LEVELS.filter((level) => inRange.has(level)).map((classLevel) => ({
      classLevel,
      outsideRange: false,
    })),
    ...CLASS_LEVELS.filter((level) => !inRange.has(level) && withRows.has(level)).map(
      (classLevel) => ({ classLevel, outsideRange: true }),
    ),
  ];
}

/** The grid's columns: the active subjects, then archived ones some class still has. */
export function gridColumns<T extends { id: string; status: 'ACTIVE' | 'ARCHIVED' }>(
  subjects: readonly T[],
  saved: CellMap,
): T[] {
  const mapped = new Set([...saved.keys()].map((key) => parseKey(key).subjectId));
  return [
    ...subjects.filter((s) => s.status === 'ACTIVE'),
    ...subjects.filter((s) => s.status === 'ARCHIVED' && mapped.has(s.id)),
  ];
}

/**
 * Whether a cell may be set: an archived subject or stream can stay in a class that already has
 * it (in any stream), but can't be newly added to another (spec section 6).
 */
export function canAddCell(
  saved: CellMap,
  level: ClassLevel,
  streamId: string | null,
  subjectId: string,
  archived: ReadonlySet<string>,
): boolean {
  const rows = rowsForClass(saved, level);
  if (archived.has(subjectId) && !rows.some((row) => row.subjectId === subjectId)) return false;
  if (streamId !== null && archived.has(streamId) && !rows.some((row) => row.streamId === streamId))
    return false;
  return true;
}

/** The row a save refusal points at through its first error's `rows.N…` path, if any. */
export function refusedRow<T>(error: unknown, rows: readonly T[]): T | null {
  if (!(error instanceof ApiError)) return null;
  const match = /^rows\.(\d+)/.exec(error.problem.errors?.[0]?.path ?? '');
  return match ? (rows[Number(match[1])] ?? null) : null;
}
