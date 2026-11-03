import type {
  Campus,
  CampusesResponse,
  CreateCampusRequest,
  UpdateCampusRequest,
} from '@classloom/contracts';
import { type HttpException, Injectable, NotFoundException } from '@nestjs/common';

import { uniqueViolationProblem } from '../../core/prisma/constraint-problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestAuth } from '../auth/request-auth';
import { AuditService } from '../iam/audit.service';
import type { SchoolMeta } from './profile.service';
import {
  CampusInactiveException,
  CampusLastActiveException,
  CampusLimitException,
  CampusNameTakenException,
  CampusPrimaryException,
} from './school-problems';

type Actor = Pick<RequestAuth, 'tenantId' | 'userId'>;

/** At most 20 campuses per school, counting inactive ones (onboarding spec section 7). */
export const MAX_CAMPUSES = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fields a campus edit can change, in the order the audit event lists them. */
const EDITABLE_KEYS = [
  'name',
  'addressLine1',
  'addressLine2',
  'district',
  'pinCode',
  'phone',
  'email',
  'city',
  'state',
] as const;

type CampusRow = Prisma.CampusGetPayload<object>;

function toCampus(row: CampusRow): Campus {
  return {
    id: row.id,
    name: row.name,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    district: row.district,
    pinCode: row.pinCode,
    phone: row.phone,
    email: row.email,
    city: row.city,
    state: row.state,
    isPrimary: row.isPrimary,
    isActive: row.status === 'ACTIVE',
  };
}

/**
 * Campuses (onboarding spec sections 4 and 7). A school always has exactly one primary campus,
 * which is active, and at least one active campus. Every change runs in one `withTenant`
 * transaction with exactly one audit event; changes to the primary flag, the status and the
 * count hold the school's campus lock first and re-read the campuses after it.
 */
@Injectable()
export class CampusesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The active campuses (or all, with `includeInactive`), primary first and then by name. */
  list(auth: Actor, includeInactive: boolean): Promise<CampusesResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const rows = await tx.campus.findMany({
        where: includeInactive ? {} : { status: 'ACTIVE' },
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      });
      return { campuses: rows.map(toCampus) };
    });
  }

  /**
   * Adds an active, non-primary campus. A city or state left out is the school's (from
   * `tenants`). Refused from the 21st campus, counting inactive ones.
   */
  create(auth: Actor, input: CreateCampusRequest, meta: SchoolMeta): Promise<Campus> {
    return this.write(auth, async (tx) => {
      await lockCampuses(tx, auth.tenantId);
      if ((await tx.campus.count()) >= MAX_CAMPUSES) throw new CampusLimitException();
      const school = await tx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { city: true, state: true },
      });
      const row = await tx.campus.create({
        data: {
          tenantId: auth.tenantId,
          ...input,
          city: input.city ?? school.city,
          state: input.state ?? school.state,
        },
      });
      const campus = toCampus(row);
      const { id: _id, isPrimary: _p, isActive: _a, ...after } = campus;
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'campus.created',
        targetType: 'campus',
        targetId: row.id,
        after,
        actor: auth,
        meta,
      });
      return campus;
    });
  }

  /**
   * Changes the fields sent (absent ones are kept, `null` clears one). No change writes nothing;
   * otherwise one `campus.updated` event holds only the changed fields.
   */
  update(auth: Actor, id: string, input: UpdateCampusRequest, meta: SchoolMeta): Promise<Campus> {
    return this.write(auth, async (tx) => {
      const current = toCampus(await this.load(tx, id));
      const before: Record<string, string | null> = {};
      const after: Record<string, string | null> = {};
      for (const key of EDITABLE_KEYS) {
        const next = input[key];
        if (next !== undefined && next !== current[key]) {
          before[key] = current[key];
          after[key] = next;
        }
      }
      if (Object.keys(after).length === 0) return current;

      const row = await tx.campus.update({
        where: { id },
        data: after,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'campus.updated',
        targetType: 'campus',
        targetId: id,
        before,
        after,
        actor: auth,
        meta,
      });
      return toCampus(row);
    });
  }

  /**
   * Moves the primary flag to this active campus. The old primary is cleared first: the partial
   * unique index `campuses_one_primary` allows one primary at a time. Already primary: no change.
   */
  makePrimary(auth: Actor, id: string, meta: SchoolMeta): Promise<Campus> {
    return this.write(auth, async (tx) => {
      await lockCampuses(tx, auth.tenantId);
      const target = await this.load(tx, id);
      if (target.isPrimary) return toCampus(target);
      if (target.status !== 'ACTIVE') throw new CampusInactiveException();
      const previous = await tx.campus.findFirst({
        where: { isPrimary: true },
        select: { id: true },
      });
      if (previous) {
        await tx.campus.update({ where: { id: previous.id }, data: { isPrimary: false } });
      }
      const row = await tx.campus.update({ where: { id }, data: { isPrimary: true } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'campus.made_primary',
        targetType: 'campus',
        targetId: id,
        before: { primaryCampusId: previous?.id ?? null },
        after: { primaryCampusId: id },
        actor: auth,
        meta,
      });
      return toCampus(row);
    });
  }

  /**
   * Deactivates a campus: refused for the primary campus (`campus-primary`, checked first) and
   * for the last active one (`campus-last-active`). Already inactive: no change.
   */
  deactivate(auth: Actor, id: string, meta: SchoolMeta): Promise<Campus> {
    return this.write(auth, async (tx) => {
      await lockCampuses(tx, auth.tenantId);
      const target = await this.load(tx, id);
      if (target.status !== 'ACTIVE') return toCampus(target);
      if (target.isPrimary) throw new CampusPrimaryException();
      const othersActive = await tx.campus.count({
        where: { status: 'ACTIVE', id: { not: id } },
      });
      if (othersActive === 0) throw new CampusLastActiveException();
      return this.setStatus(tx, auth, target, 'INACTIVE', meta);
    });
  }

  /** Reactivates a campus. Already active: no change. */
  reactivate(auth: Actor, id: string, meta: SchoolMeta): Promise<Campus> {
    return this.write(auth, async (tx) => {
      await lockCampuses(tx, auth.tenantId);
      const target = await this.load(tx, id);
      if (target.status === 'ACTIVE') return toCampus(target);
      return this.setStatus(tx, auth, target, 'ACTIVE', meta);
    });
  }

  private async setStatus(
    tx: Prisma.TransactionClient,
    auth: Actor,
    target: CampusRow,
    status: 'ACTIVE' | 'INACTIVE',
    meta: SchoolMeta,
  ): Promise<Campus> {
    const row = await tx.campus.update({ where: { id: target.id }, data: { status } });
    await this.audit.record(tx, {
      tenantId: auth.tenantId,
      action: status === 'ACTIVE' ? 'campus.reactivated' : 'campus.deactivated',
      targetType: 'campus',
      targetId: target.id,
      before: { status: target.status },
      after: { status },
      actor: auth,
      meta,
    });
    return toCampus(row);
  }

  /** The campus in the current school (row-level security narrows the query), or 404. */
  private async load(tx: Prisma.TransactionClient, id: string): Promise<CampusRow> {
    const row = UUID.test(id) ? await tx.campus.findUnique({ where: { id } }) : null;
    if (!row) throw new NotFoundException('Campus not found');
    return row;
  }

  /** One transaction scoped to the caller's school, turning constraint violations into 409s. */
  private async write<T>(
    auth: Actor,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await withTenant(this.prisma, auth.tenantId, fn);
    } catch (error) {
      throw campusWriteProblem(error) ?? error;
    }
  }
}

/**
 * Serialises changes to one school's primary flag, statuses and count: a transaction-scoped
 * advisory lock, then a row lock on the school's campuses (Part 3's last-owner pattern). Callers
 * read the campuses only after it.
 */
async function lockCampuses(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campuses:${tenantId}`}, 0))`;
  await tx.$executeRaw`SELECT id FROM campuses WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
}

/** The unique indexes of `campuses` this service maps, by name (see the migrations). */
const UNIQUE_PROBLEMS = [['campuses_name_key', () => new CampusNameTakenException()]] as const;

/** The problem for a database error from writing a campus, or null when it is not one of ours. */
export function campusWriteProblem(error: unknown): HttpException | null {
  return uniqueViolationProblem(error, UNIQUE_PROBLEMS);
}
