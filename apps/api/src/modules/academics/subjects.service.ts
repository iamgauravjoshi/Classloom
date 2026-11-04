import {
  type CreateSubjectRequest,
  STARTER_SUBJECTS,
  type StarterSubjectsAddedResponse,
  type StarterSubjectsRequest,
  type StarterSubjectsResponse,
  type Subject,
  type SubjectsResponse,
  type UpdateSubjectRequest,
} from '@classloom/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../iam/audit.service';
import { AcademicsLimits } from './academics-limits';
import { InUseException } from './academics-problems';
import {
  academicsWrite,
  type Actor,
  type AuditMeta,
  changedFields,
  isUuid,
  notFound,
} from './academics-write';

type SubjectRow = Prisma.SubjectGetPayload<object>;

export function toSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const key = (name: string) => name.toLowerCase();

/**
 * Subjects and the board starter lists (academics spec sections 5 and 6, "Subjects"). Every
 * write runs in one `withTenant` transaction with its audit row; creates hold the school's
 * subject lock for the limit.
 */
@Injectable()
export class SubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every subject, active first, then by name. */
  list(auth: Actor): Promise<SubjectsResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const rows = await tx.subject.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
      return { subjects: rows.map(toSubject) };
    });
  }

  /** The school's board's starter list, with `exists` for names the school has (ignoring case). */
  starter(auth: Actor): Promise<StarterSubjectsResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const { board } = await tx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { board: true },
      });
      const have = new Set(
        (await tx.subject.findMany({ select: { name: true } })).map((s) => key(s.name)),
      );
      return {
        board,
        items: STARTER_SUBJECTS[board].map((item) => ({
          name: item.name,
          code: item.code ?? null,
          type: item.type,
          exists: have.has(key(item.name)),
        })),
      };
    });
  }

  /**
   * Creates the items whose name the school does not have yet (ignoring case; a name repeated in
   * the request counts once) and reports the others as skipped. One `subjects.starter_added` row
   * names what was created; nothing created writes nothing.
   */
  addStarter(
    auth: Actor,
    input: StarterSubjectsRequest,
    meta: AuditMeta,
  ): Promise<StarterSubjectsAddedResponse> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      await AcademicsLimits.lock(tx, 'subjects', auth.tenantId);
      const seen = new Set(
        (await tx.subject.findMany({ select: { name: true } })).map((s) => key(s.name)),
      );
      const toCreate: StarterSubjectsRequest['items'] = [];
      const skipped: string[] = [];
      for (const item of input.items) {
        if (seen.has(key(item.name))) skipped.push(item.name);
        else {
          seen.add(key(item.name));
          toCreate.push(item);
        }
      }
      if (toCreate.length === 0) return { created: [], skipped };

      await AcademicsLimits.assertBelow(tx, 'subjects', auth.tenantId, {
        adding: toCreate.length,
      });
      const rows = await tx.subject.createManyAndReturn({
        data: toCreate.map((item) => ({
          tenantId: auth.tenantId,
          name: item.name,
          code: item.code ?? null,
          type: item.type,
        })),
      });
      const byName = new Map(rows.map((r) => [key(r.name), r]));
      const created = toCreate.map((item) => toSubject(byName.get(key(item.name))!));
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'subjects.starter_added',
        targetType: 'subject',
        // A batch has no single subject: the target is the school's subject list.
        targetId: auth.tenantId,
        after: { names: created.map((s) => s.name) },
        actor: auth,
        meta,
      });
      return { created, skipped };
    });
  }

  /** Adds one active subject; refused from the 201st. Codes are labels and may repeat. */
  create(auth: Actor, input: CreateSubjectRequest, meta: AuditMeta): Promise<Subject> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      await AcademicsLimits.assertBelow(tx, 'subjects', auth.tenantId);
      const row = await tx.subject.create({
        data: {
          tenantId: auth.tenantId,
          name: input.name,
          code: input.code ?? null,
          type: input.type,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'subject.created',
        targetType: 'subject',
        targetId: row.id,
        after: { name: row.name, code: row.code, type: row.type },
        actor: auth,
        meta,
      });
      return toSubject(row);
    });
  }

  /**
   * Changes the fields sent (absent ones are kept, `null` or "" clears the code). No change
   * writes nothing; otherwise one `subject.updated` row holds only the changed fields.
   */
  update(auth: Actor, id: string, input: UpdateSubjectRequest, meta: AuditMeta): Promise<Subject> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const current = await this.load(tx, id);
      const { before, after } = changedFields(['name', 'code', 'type'], current, input);
      if (Object.keys(after).length === 0) return toSubject(current);
      const row = await tx.subject.update({ where: { id }, data: after });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'subject.updated',
        targetType: 'subject',
        targetId: id,
        before,
        after,
        actor: auth,
        meta,
      });
      return toSubject(row);
    });
  }

  /**
   * Archives or restores; already in that state is a no-op. An archived subject stays in the
   * classes that have it but cannot be newly added to one.
   */
  setStatus(
    auth: Actor,
    id: string,
    status: 'ACTIVE' | 'ARCHIVED',
    meta: AuditMeta,
  ): Promise<Subject> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const current = await this.load(tx, id);
      if (current.status === status) return toSubject(current);
      const row = await tx.subject.update({ where: { id }, data: { status } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: status === 'ARCHIVED' ? 'subject.archived' : 'subject.restored',
        targetType: 'subject',
        targetId: id,
        before: { status: current.status },
        after: { status },
        actor: auth,
        meta,
      });
      return toSubject(row);
    });
  }

  /** Deletes a subject no class uses; otherwise 409 `in-use` with `{ classSubjects }`. */
  remove(auth: Actor, id: string, meta: AuditMeta): Promise<void> {
    return academicsWrite(
      this.prisma,
      auth.tenantId,
      async (tx) => {
        const current = await this.load(tx, id);
        const classSubjects = await tx.classSubject.count({ where: { subjectId: id } });
        if (classSubjects > 0) throw new InUseException({ classSubjects });
        await tx.subject.delete({ where: { id } });
        await this.audit.record(tx, {
          tenantId: auth.tenantId,
          action: 'subject.deleted',
          targetType: 'subject',
          targetId: id,
          before: {
            name: current.name,
            code: current.code,
            type: current.type,
            status: current.status,
          },
          actor: auth,
          meta,
        });
      },
      { inUseOnForeignKey: true },
    );
  }

  /** The subject in the current school (row-level security narrows the query), or 404. */
  private async load(tx: Prisma.TransactionClient, id: string): Promise<SubjectRow> {
    const row = isUuid(id) ? await tx.subject.findUnique({ where: { id } }) : null;
    if (!row) throw notFound('Subject');
    return row;
  }
}
