import type {
  AcademicStatus,
  CreateRoomRequest,
  Room,
  RoomsResponse,
  UpdateRoomRequest,
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

type RoomRow = Prisma.RoomGetPayload<object>;

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    campusId: row.campusId,
    name: row.name,
    type: row.type,
    capacity: row.capacity,
    floor: row.floor,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The fields a room edit can change, in the order the audit row lists them. */
const ROOM_FIELDS = ['name', 'type', 'capacity', 'floor', 'status'] as const;

/**
 * Rooms (academics spec section 6, "Houses and rooms"). A room stays on the campus it was made
 * on (the request cannot move it), so a section's room is always on the section's campus.
 * Archiving keeps the room on its sections; deleting needs no section to use it.
 */
@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The school's rooms, optionally of one campus or status; active first, then by name. */
  list(
    auth: Actor,
    filter: { campusId?: string; status?: AcademicStatus },
  ): Promise<RoomsResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      const rows = await tx.room.findMany({
        where: {
          ...(filter.campusId ? { campusId: filter.campusId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      });
      return { rooms: rows.map(toRoom) };
    });
  }

  /** Adds one active room on a campus of this school (404 otherwise); refused from the 501st. */
  create(auth: Actor, input: CreateRoomRequest, meta: AuditMeta): Promise<Room> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const campus = await tx.campus.findUnique({ where: { id: input.campusId } });
      if (!campus) throw notFound('Campus');
      await AcademicsLimits.assertBelow(tx, 'rooms', auth.tenantId);
      const row = await tx.room.create({
        data: {
          tenantId: auth.tenantId,
          campusId: input.campusId,
          name: input.name,
          type: input.type,
          capacity: input.capacity,
          floor: input.floor ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'room.created',
        targetType: 'room',
        targetId: row.id,
        after: {
          campusId: row.campusId,
          name: row.name,
          type: row.type,
          capacity: row.capacity,
          floor: row.floor,
        },
        actor: auth,
        meta,
      });
      return toRoom(row);
    });
  }

  /** Changes the room's fields; no change writes nothing, else one `room.updated` row. */
  update(auth: Actor, id: string, input: UpdateRoomRequest, meta: AuditMeta): Promise<Room> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const current = await this.load(tx, id);
      const { before, after } = changedFields(ROOM_FIELDS, current, input);
      if (Object.keys(after).length === 0) return toRoom(current);
      const row = await tx.room.update({ where: { id }, data: after });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'room.updated',
        targetType: 'room',
        targetId: id,
        before,
        after,
        actor: auth,
        meta,
      });
      return toRoom(row);
    });
  }

  /** Archives or restores; already in that state is a no-op. Sections keep an archived room. */
  setStatus(
    auth: Actor,
    id: string,
    status: 'ACTIVE' | 'ARCHIVED',
    meta: AuditMeta,
  ): Promise<Room> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      const current = await this.load(tx, id);
      if (current.status === status) return toRoom(current);
      const row = await tx.room.update({ where: { id }, data: { status } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: status === 'ARCHIVED' ? 'room.archived' : 'room.restored',
        targetType: 'room',
        targetId: id,
        before: { status: current.status },
        after: { status },
        actor: auth,
        meta,
      });
      return toRoom(row);
    });
  }

  /**
   * Deletes a room no section uses; otherwise 409 `in-use` with `{ sections }`. (The database
   * would clear the sections' room instead, so the count is the guard.) Holds the school's
   * section lock so a section cannot take the room between the count and the delete.
   */
  remove(auth: Actor, id: string, meta: AuditMeta): Promise<void> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      await AcademicsLimits.lock(tx, 'sections', auth.tenantId);
      const current = await this.load(tx, id);
      const sections = await tx.section.count({ where: { roomId: id } });
      if (sections > 0) throw new InUseException({ sections });
      await tx.room.delete({ where: { id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'room.deleted',
        targetType: 'room',
        targetId: id,
        before: {
          campusId: current.campusId,
          name: current.name,
          type: current.type,
          capacity: current.capacity,
          floor: current.floor,
          status: current.status,
        },
        actor: auth,
        meta,
      });
    });
  }

  /** The room in the current school (row-level security narrows the query), or 404. */
  private async load(tx: Prisma.TransactionClient, id: string): Promise<RoomRow> {
    const row = isUuid(id) ? await tx.room.findUnique({ where: { id } }) : null;
    if (!row) throw notFound('Room');
    return row;
  }
}
