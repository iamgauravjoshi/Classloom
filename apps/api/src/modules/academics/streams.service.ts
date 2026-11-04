import {
  type CreateStreamRequest,
  STARTER_STREAMS,
  type StarterStreamsAddedResponse,
  type Stream,
  type StreamsResponse,
  type UpdateStreamRequest,
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

type StreamRow = Prisma.StreamGetPayload<object>;

export function toStream(row: StreamRow): Stream {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Streams (academics spec section 6, "Streams"). Every write runs in one `withTenant`
 * transaction with its audit rows; creates hold the school's stream lock for the limit.
 */
@Injectable()
export class StreamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every stream, active first, then by name. */
  list(auth: Actor): Promise<StreamsResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const rows = await tx.stream.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
      return { streams: rows.map(toStream) };
    });
  }

  /** Adds one active stream; refused from the 21st. */
  create(auth: Actor, input: CreateStreamRequest, meta: AuditMeta): Promise<Stream> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      await AcademicsLimits.assertBelow(tx, 'streams', auth.tenantId);
      return this.insert(tx, auth, input.name, meta);
    });
  }

  /**
   * Adds Science, Commerce and Humanities, skipping any whose name the school already has
   * (ignoring case). Each new stream writes its own `stream.created` row.
   */
  addStarter(auth: Actor, meta: AuditMeta): Promise<StarterStreamsAddedResponse> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      await AcademicsLimits.lock(tx, 'streams', auth.tenantId);
      const existing = new Set(
        (await tx.stream.findMany({ select: { name: true } })).map((s) => s.name.toLowerCase()),
      );
      const missing = STARTER_STREAMS.filter((name) => !existing.has(name.toLowerCase()));
      const skipped = STARTER_STREAMS.filter((name) => existing.has(name.toLowerCase()));
      if (missing.length > 0) {
        await AcademicsLimits.assertBelow(tx, 'streams', auth.tenantId, {
          adding: missing.length,
        });
      }
      const created: Stream[] = [];
      for (const name of missing) created.push(await this.insert(tx, auth, name, meta));
      return { created, skipped };
    });
  }

  /** Renames; no change writes nothing, else one `stream.updated` row. */
  update(auth: Actor, id: string, input: UpdateStreamRequest, meta: AuditMeta): Promise<Stream> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const current = await this.load(tx, id);
      const { before, after } = changedFields(['name'], current, input);
      if (Object.keys(after).length === 0) return toStream(current);
      const row = await tx.stream.update({ where: { id }, data: after });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'stream.updated',
        targetType: 'stream',
        targetId: id,
        before,
        after,
        actor: auth,
        meta,
      });
      return toStream(row);
    });
  }

  /** Archives or restores; already in that state is a no-op. */
  setStatus(
    auth: Actor,
    id: string,
    status: 'ACTIVE' | 'ARCHIVED',
    meta: AuditMeta,
  ): Promise<Stream> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const current = await this.load(tx, id);
      if (current.status === status) return toStream(current);
      const row = await tx.stream.update({ where: { id }, data: { status } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: status === 'ARCHIVED' ? 'stream.archived' : 'stream.restored',
        targetType: 'stream',
        targetId: id,
        before: { status: current.status },
        after: { status },
        actor: auth,
        meta,
      });
      return toStream(row);
    });
  }

  /** Deletes a stream no section or class subject uses; otherwise 409 `in-use` with counts. */
  remove(auth: Actor, id: string, meta: AuditMeta): Promise<void> {
    return academicsWrite(
      this.prisma,
      auth.tenantId,
      async (tx) => {
        const current = await this.load(tx, id);
        const [sections, classSubjects] = await Promise.all([
          tx.section.count({ where: { streamId: id } }),
          tx.classSubject.count({ where: { streamId: id } }),
        ]);
        if (sections + classSubjects > 0) throw new InUseException({ sections, classSubjects });
        await tx.stream.delete({ where: { id } });
        await this.audit.record(tx, {
          tenantId: auth.tenantId,
          action: 'stream.deleted',
          targetType: 'stream',
          targetId: id,
          before: { name: current.name, status: current.status },
          actor: auth,
          meta,
        });
      },
      { inUseOnForeignKey: true },
    );
  }

  private async insert(
    tx: Prisma.TransactionClient,
    auth: Actor,
    name: string,
    meta: AuditMeta,
  ): Promise<Stream> {
    const row = await tx.stream.create({ data: { tenantId: auth.tenantId, name } });
    await this.audit.record(tx, {
      tenantId: auth.tenantId,
      action: 'stream.created',
      targetType: 'stream',
      targetId: row.id,
      after: { name: row.name },
      actor: auth,
      meta,
    });
    return toStream(row);
  }

  /** The stream in the current school (row-level security narrows the query), or 404. */
  private async load(tx: Prisma.TransactionClient, id: string): Promise<StreamRow> {
    const row = isUuid(id) ? await tx.stream.findUnique({ where: { id } }) : null;
    if (!row) throw notFound('Stream');
    return row;
  }
}
