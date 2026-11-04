import type {
  CreateHouseRequest,
  House,
  HousesResponse,
  UpdateHouseRequest,
} from '@classloom/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../iam/audit.service';
import { AcademicsLimits } from './academics-limits';
import {
  academicsWrite,
  type Actor,
  type AuditMeta,
  changedFields,
  isUuid,
  notFound,
} from './academics-write';

type HouseRow = Prisma.HouseGetPayload<object>;

function toHouse(row: HouseRow): House {
  return {
    id: row.id,
    name: row.name,
    colour: row.colour,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Houses (academics spec section 6, "Houses and rooms"). Every write runs in one `withTenant`
 * transaction with its audit row; creates hold the school's house lock for the limit. A house
 * can always be deleted until Phase 2 gives it pupils.
 */
@Injectable()
export class HousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every house, active first, then by name. */
  list(auth: Actor): Promise<HousesResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const rows = await tx.house.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
      return { houses: rows.map(toHouse) };
    });
  }

  /** Adds one active house; refused from the 21st. */
  create(auth: Actor, input: CreateHouseRequest, meta: AuditMeta): Promise<House> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      await AcademicsLimits.assertBelow(tx, 'houses', auth.tenantId);
      const row = await tx.house.create({
        data: { tenantId: auth.tenantId, name: input.name, colour: input.colour },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'house.created',
        targetType: 'house',
        targetId: row.id,
        after: { name: row.name, colour: row.colour },
        actor: auth,
        meta,
      });
      return toHouse(row);
    });
  }

  /** Changes the name, colour or status; no change writes nothing, else one `house.updated` row. */
  update(auth: Actor, id: string, input: UpdateHouseRequest, meta: AuditMeta): Promise<House> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const current = await this.load(tx, id);
      const { before, after } = changedFields(['name', 'colour', 'status'], current, input);
      if (Object.keys(after).length === 0) return toHouse(current);
      const row = await tx.house.update({ where: { id }, data: after });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'house.updated',
        targetType: 'house',
        targetId: id,
        before,
        after,
        actor: auth,
        meta,
      });
      return toHouse(row);
    });
  }

  /** Archives or restores; already in that state is a no-op. */
  setStatus(
    auth: Actor,
    id: string,
    status: 'ACTIVE' | 'ARCHIVED',
    meta: AuditMeta,
  ): Promise<House> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const current = await this.load(tx, id);
      if (current.status === status) return toHouse(current);
      const row = await tx.house.update({ where: { id }, data: { status } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: status === 'ARCHIVED' ? 'house.archived' : 'house.restored',
        targetType: 'house',
        targetId: id,
        before: { status: current.status },
        after: { status },
        actor: auth,
        meta,
      });
      return toHouse(row);
    });
  }

  /** Deletes a house with one `house.deleted` row. */
  remove(auth: Actor, id: string, meta: AuditMeta): Promise<void> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const current = await this.load(tx, id);
      await tx.house.delete({ where: { id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'house.deleted',
        targetType: 'house',
        targetId: id,
        before: { name: current.name, colour: current.colour, status: current.status },
        actor: auth,
        meta,
      });
    });
  }

  /** The house in the current school (row-level security narrows the query), or 404. */
  private async load(tx: Prisma.TransactionClient, id: string): Promise<HouseRow> {
    const row = isUuid(id) ? await tx.house.findUnique({ where: { id } }) : null;
    if (!row) throw notFound('House');
    return row;
  }
}
