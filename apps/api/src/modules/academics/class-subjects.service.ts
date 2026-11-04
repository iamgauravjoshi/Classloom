import {
  checkClassSubjectRows,
  CLASS_LEVELS,
  classesInRange,
  type ClassLevel,
  type ClassSubjectRow,
  type ClassSubjectsClass,
  type ClassSubjectsResponse,
  isInRange,
} from '@classloom/contracts';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../iam/audit.service';
import {
  StreamArchivedException,
  StreamNotAllowedException,
  SubjectArchivedException,
} from './academics-problems';
import { academicsWrite, type Actor, type AuditMeta } from './academics-write';
import { ClassRange } from './class-range';

const ROW_SELECT = { classLevel: true, subjectId: true, streamId: true, kind: true } as const;
/** "All streams" rows first, then by stream, then by subject name. */
const ROW_ORDER: Prisma.ClassSubjectOrderByWithRelationInput[] = [
  { streamId: { sort: 'asc', nulls: 'first' } },
  { subject: { name: 'asc' } },
];

const toRow = (r: {
  subjectId: string;
  streamId: string | null;
  kind: ClassSubjectRow['kind'];
}) => ({
  subjectId: r.subjectId,
  streamId: r.streamId,
  kind: r.kind,
});

/** A stable order for the audit lists and for comparing them. */
const sortRows = (rows: readonly ClassSubjectRow[]): ClassSubjectRow[] =>
  rows
    .map(toRow)
    .sort((a, b) =>
      `${a.subjectId}|${a.streamId ?? ''}`.localeCompare(`${b.subjectId}|${b.streamId ?? ''}`),
    );

const sameRows = (a: readonly ClassSubjectRow[], b: readonly ClassSubjectRow[]) =>
  JSON.stringify(sortRows(a)) === JSON.stringify(sortRows(b));

/** 422 for a row that names something the request cannot use; `path` is the failing field. */
const rowProblem = (path: string, message: string) =>
  new UnprocessableEntityException({ message, errors: [{ path, message }] });

/**
 * The subjects each class takes (academics spec section 6, "Class subjects"). A class's rows are
 * replaced as a whole: the PUT holds a per-school-and-class advisory lock, then deletes and
 * re-inserts in one transaction, so concurrent saves end with exactly one request's rows.
 */
@Injectable()
export class ClassSubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every class in the profile range (empty ones too), plus any class outside it that still has
   * rows (marked `outsideRange`), in class order.
   */
  list(auth: Actor): Promise<ClassSubjectsResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const range = await ClassRange.load(tx, auth.tenantId);
      const rows = await tx.classSubject.findMany({ select: ROW_SELECT, orderBy: ROW_ORDER });
      const byLevel = new Map<ClassLevel, ClassSubjectRow[]>(
        classesInRange(range.lowest, range.highest).map((level) => [level, []]),
      );
      for (const row of rows) {
        const list = byLevel.get(row.classLevel) ?? [];
        list.push(toRow(row));
        byLevel.set(row.classLevel, list);
      }
      return {
        classes: CLASS_LEVELS.filter((level) => byLevel.has(level)).map((level) => ({
          classLevel: level,
          outsideRange: !isInRange(level, range.lowest, range.highest),
          rows: byLevel.get(level)!,
        })),
      };
    });
  }

  /**
   * Replaces the class's rows. The class must be in the profile range (409 `classes-not-set`,
   * 422 `class-out-of-range`); only XI and XII rows name a stream (422 `stream-not-allowed`);
   * a subject or stream must be this school's and active, or already in this class (422
   * `subject-archived`, `stream-archived`). A subject or stream deleted meanwhile is a 422 too.
   * The same rows again write nothing; otherwise one `class_subjects.updated` row holds the
   * before and after lists.
   */
  replace(
    auth: Actor,
    level: ClassLevel,
    rows: readonly ClassSubjectRow[],
    meta: AuditMeta,
  ): Promise<ClassSubjectsClass> {
    return academicsWrite(
      this.prisma,
      auth.tenantId,
      async (tx) => {
        const lockKey = `class-subjects:${auth.tenantId}:${level}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        ClassRange.assertWritable(await ClassRange.load(tx, auth.tenantId), level);

        const check = checkClassSubjectRows(level, rows);
        if (!check.ok) {
          if (check.problem === 'stream-not-allowed') {
            throw new StreamNotAllowedException([
              { path: `rows.${check.index}.streamId`, message: 'Only XI and XII have streams.' },
            ]);
          }
          throw rowProblem(
            `rows.${check.index}`,
            'This subject is already listed for this stream.',
          );
        }

        const current = await tx.classSubject.findMany({
          where: { classLevel: level },
          select: ROW_SELECT,
        });
        await this.assertUsable(tx, rows, current);

        const result = { classLevel: level, outsideRange: false };
        if (sameRows(current, rows)) return { ...result, rows: await this.rowsOf(tx, level) };

        await tx.classSubject.deleteMany({ where: { classLevel: level } });
        await tx.classSubject.createMany({
          data: rows.map((row) => ({
            tenantId: auth.tenantId,
            classLevel: level,
            subjectId: row.subjectId,
            streamId: row.streamId,
            kind: row.kind,
          })),
        });
        await this.audit.record(tx, {
          tenantId: auth.tenantId,
          action: 'class_subjects.updated',
          targetType: 'class_level',
          // A class level has no row of its own: the target is the school, and the level is named
          // in before and after.
          targetId: auth.tenantId,
          before: { classLevel: level, rows: sortRows(current) },
          after: { classLevel: level, rows: sortRows(rows) },
          actor: auth,
          meta,
        });
        return { ...result, rows: await this.rowsOf(tx, level) };
      },
      // A subject or stream deleted between the check above and the insert.
      {
        foreignKeyProblem: () =>
          rowProblem('rows', 'A subject or stream was just deleted. Reload and try again.'),
      },
    );
  }

  /**
   * Every subject and stream named must be this school's (row-level security hides others), and
   * active unless the class already has it.
   */
  private async assertUsable(
    tx: Prisma.TransactionClient,
    rows: readonly ClassSubjectRow[],
    current: readonly ClassSubjectRow[],
  ): Promise<void> {
    const subjectIds = [...new Set(rows.map((r) => r.subjectId))];
    const streamIds = [...new Set(rows.flatMap((r) => (r.streamId ? [r.streamId] : [])))];
    const [subjects, streams] = await Promise.all([
      tx.subject.findMany({
        where: { id: { in: subjectIds } },
        select: { id: true, status: true },
      }),
      tx.stream.findMany({ where: { id: { in: streamIds } }, select: { id: true, status: true } }),
    ]);
    const subjectStatus = new Map(subjects.map((s) => [s.id, s.status]));
    const streamStatus = new Map(streams.map((s) => [s.id, s.status]));
    const hadSubject = new Set(current.map((r) => r.subjectId));
    const hadStream = new Set(current.flatMap((r) => (r.streamId ? [r.streamId] : [])));

    for (const [i, row] of rows.entries()) {
      const subject = subjectStatus.get(row.subjectId);
      if (subject === undefined) {
        throw rowProblem(`rows.${i}.subjectId`, 'No such subject in this school.');
      }
      if (subject === 'ARCHIVED' && !hadSubject.has(row.subjectId)) {
        throw new SubjectArchivedException([
          { path: `rows.${i}.subjectId`, message: 'This subject is archived.' },
        ]);
      }
      if (row.streamId === null) continue;
      const stream = streamStatus.get(row.streamId);
      if (stream === undefined) {
        throw rowProblem(`rows.${i}.streamId`, 'No such stream in this school.');
      }
      if (stream === 'ARCHIVED' && !hadStream.has(row.streamId)) {
        throw new StreamArchivedException([
          { path: `rows.${i}.streamId`, message: 'This stream is archived.' },
        ]);
      }
    }
  }

  private async rowsOf(
    tx: Prisma.TransactionClient,
    level: ClassLevel,
  ): Promise<ClassSubjectRow[]> {
    const rows = await tx.classSubject.findMany({
      where: { classLevel: level },
      select: ROW_SELECT,
      orderBy: ROW_ORDER,
    });
    return rows.map(toRow);
  }
}
