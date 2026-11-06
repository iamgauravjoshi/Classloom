import {
  areaOfAction,
  AUDIT_AREAS,
  type AuditEvent,
  type AuditEventsPage,
  type AuditEventsQuery,
} from '@classloom/contracts';
import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import { Prisma } from '../../generated/prisma/client';
import type { Actor, AuditMeta } from '../academics/academics-write';
import { AuditService } from '../iam/audit.service';
import { auditCsv } from './audit-csv';
import { deviceOf } from './device';
import { targetKey, TargetLabels } from './target-labels';

/** The most rows one CSV export holds (Part 6a spec section 5). */
export const EXPORT_LIMIT = 5000;

/** 422: the filter matches more rows than one export holds; narrow it. */
export class ExportTooLargeException extends HttpException {
  constructor(readonly limit: number) {
    super(
      {
        type: 'export-too-large',
        title: 'Too many events to export.',
        message: `An export holds up to ${limit} events. Narrow the dates or filters.`,
        limit,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** The filters both routes take; the cursor and the page size apply only to the list. */
export type AuditFilter = Pick<AuditEventsQuery, 'from' | 'to' | 'actorUserId' | 'area'>;

/** Shown for an actor whose membership of this school no longer exists. */
const FORMER_MEMBER = 'Former member';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EventRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  actor_user_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
  /** `created_at` to the microsecond, for the cursor. */
  created_at_cursor: string;
}

const bad = (message: string) =>
  new BadRequestException({ title: 'A filter is not valid.', message });

/** True for a real `YYYY-MM-DD` calendar date (the contract only checks the shape). */
function isCalendarDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function checkFilter(filter: AuditFilter): void {
  for (const key of ['from', 'to'] as const) {
    const value = filter[key];
    if (value !== undefined && !isCalendarDate(value)) throw bad(`${key} is not a real date.`);
  }
  if (filter.actorUserId !== undefined && !UUID.test(filter.actorUserId)) {
    throw bad('actorUserId is not a member id.');
  }
}

const encodeCursor = (createdAt: string, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.createdAt === 'string' &&
      typeof parsed.id === 'string' &&
      UUID.test(parsed.id) &&
      !Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // falls through to the 400 below
  }
  throw new BadRequestException({ title: 'That page link is not valid.', message: 'Bad cursor.' });
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * One `{ field, before, after }` per key whose value differs between the stored before and after
 * (a missing side is null); keys in the order `after` lists them, then those only in `before`.
 */
export function changesOf(before: unknown, after: unknown): AuditEvent['changes'] {
  if ((before !== null && !isObject(before)) || (after !== null && !isObject(after))) {
    return canonical(before) === canonical(after) ? [] : [{ field: 'value', before, after }];
  }
  const b = before ?? {};
  const a = after ?? {};
  const keys = [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a))];
  return keys
    .filter((k) => canonical(b[k]) !== canonical(a[k]))
    .map((field) => ({ field, before: b[field] ?? null, after: a[field] ?? null }));
}

/**
 * The school's audit trail (Part 6a spec section 5), read under its row-level security: a page of
 * events newest first, or a CSV of up to 5,000. Labels and actor names are looked up at read time
 * from this school's rows only.
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A page of events, newest first by `(created_at, id)`; `nextCursor` is null on the last. */
  list(auth: Actor, query: AuditEventsQuery): Promise<AuditEventsPage> {
    checkFilter(query);
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const limit = query.limit;
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const rows = await this.rows(tx, auth.tenantId, query, after, limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        events: await this.toEvents(tx, page),
        nextCursor:
          rows.length > limit && last ? encodeCursor(last.created_at_cursor, last.id) : null,
      };
    });
  }

  /**
   * The filter's events as CSV, newest first, with one `audit.exported` row (the filter in
   * `after`) written in the same transaction. More than 5,000 matching rows is refused.
   */
  export(
    auth: Actor,
    filter: AuditFilter,
    meta: AuditMeta,
  ): Promise<{ filename: string; csv: string }> {
    checkFilter(filter);
    const recorded: Json = {};
    for (const key of ['from', 'to', 'actorUserId', 'area'] as const) {
      if (filter[key] !== undefined) recorded[key] = filter[key];
    }
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const rows = await this.rows(tx, auth.tenantId, filter, null, EXPORT_LIMIT + 1);
      if (rows.length > EXPORT_LIMIT) throw new ExportTooLargeException(EXPORT_LIMIT);
      const csv = auditCsv(await this.toEvents(tx, rows));
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'audit.exported',
        targetType: 'audit',
        targetId: auth.tenantId,
        after: recorded as Prisma.InputJsonObject,
        actor: auth,
        meta,
      });
      return {
        filename: `audit-log-${filter.from ?? 'all'}-${filter.to ?? 'all'}.csv`,
        csv,
      };
    });
  }

  private rows(
    tx: Prisma.TransactionClient,
    tenantId: string,
    filter: AuditFilter,
    after: { createdAt: string; id: string } | null,
    take: number,
  ): Promise<EventRow[]> {
    const where: Prisma.Sql[] = [Prisma.sql`e.tenant_id = ${tenantId}::uuid`];
    if (filter.from !== undefined) {
      where.push(
        Prisma.sql`e.created_at >= (${filter.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      );
    }
    if (filter.to !== undefined) {
      where.push(
        Prisma.sql`e.created_at < ((${filter.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      );
    }
    if (filter.actorUserId !== undefined) {
      where.push(Prisma.sql`e.actor_user_id = ${filter.actorUserId}::uuid`);
    }
    if (filter.area !== undefined) {
      // starts_with, not LIKE: `_` in `academic_year.` would be a wildcard.
      const prefixes = AUDIT_AREAS[filter.area].map((p) => Prisma.sql`starts_with(e.action, ${p})`);
      where.push(Prisma.sql`(${Prisma.join(prefixes, ' OR ')})`);
    }
    if (after) {
      where.push(
        Prisma.sql`(e.created_at, e.id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`,
      );
    }
    return tx.$queryRaw<EventRow[]>(Prisma.sql`
      SELECT e.id::text AS id, e.action, e.target_type, e.target_id::text AS target_id,
             e.actor_user_id::text AS actor_user_id, e.before, e.after,
             host(e.ip) AS ip, e.user_agent, e.created_at,
             to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
        FROM audit_events e
       WHERE ${Prisma.join(where, ' AND ')}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ${take}`);
  }

  private async toEvents(tx: Prisma.TransactionClient, rows: EventRow[]): Promise<AuditEvent[]> {
    const labels = await TargetLabels.resolve(
      tx,
      rows.map((r) => ({ type: r.target_type, id: r.target_id })),
    );
    const actorIds = [...new Set(rows.flatMap((r) => (r.actor_user_id ? [r.actor_user_id] : [])))];
    // Names only through this school's memberships (row-level security), never users at large.
    const members =
      actorIds.length === 0
        ? []
        : await tx.membership.findMany({
            where: { userId: { in: actorIds } },
            select: { userId: true, user: { select: { name: true } } },
          });
    const names = new Map(members.map((m) => [m.userId, m.user.name]));

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      area: areaOfAction(r.action),
      createdAt: r.created_at.toISOString(),
      actor: r.actor_user_id
        ? { userId: r.actor_user_id, name: names.get(r.actor_user_id) ?? FORMER_MEMBER }
        : null,
      target: {
        type: r.target_type,
        id: r.target_id,
        label: labels.get(targetKey(r.target_type, r.target_id)) ?? null,
      },
      changes: changesOf(r.before, r.after),
      ip: r.ip,
      device: deviceOf(r.user_agent),
    }));
  }
}
