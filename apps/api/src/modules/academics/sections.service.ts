import {
  type ClassLevel,
  type ClassTeacherOptionsResponse,
  type CopySectionsRequest,
  type CopySectionsResponse,
  type CreateSectionRequest,
  isInRange,
  isSeniorClass,
  planCopyForward,
  type Section,
  type SectionsResponse,
  type UpdateSectionRequest,
} from '@classloom/contracts';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { withTenant } from '../../core/tenancy/with-tenant';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../iam/audit.service';
import { AcademicsLimits } from './academics-limits';
import {
  AcademicYearLockedException,
  ClassesNotSetException,
  NothingToCopyException,
  RoomArchivedException,
  RoomCampusMismatchException,
  SectionsExistException,
  StreamArchivedException,
  StreamNotAllowedException,
  StreamRequiredException,
  TeacherTakenException,
  TeacherUnavailableException,
} from './academics-problems';
import {
  academicsWrite,
  type Actor,
  type AuditMeta,
  changedFields,
  isUuid,
  notFound,
} from './academics-write';
import { ClassRange, type ClassRangeValue } from './class-range';

const SECTION_INCLUDE = {
  stream: { select: { id: true, name: true } },
  room: { select: { id: true, name: true } },
  classTeacher: { select: { id: true, status: true, user: { select: { name: true } } } },
} as const;
type SectionRow = Prisma.SectionGetPayload<{ include: typeof SECTION_INCLUDE }>;
type YearRow = Prisma.AcademicYearGetPayload<object>;

function toSection(row: SectionRow, range: ClassRangeValue): Section {
  return {
    id: row.id,
    academicYearId: row.academicYearId,
    campusId: row.campusId,
    classLevel: row.classLevel,
    outsideRange: !isInRange(row.classLevel, range.lowest, range.highest),
    name: row.name,
    capacity: row.capacity,
    stream: row.stream ? { id: row.stream.id, name: row.stream.name } : null,
    room: row.room ? { id: row.room.id, name: row.room.name } : null,
    classTeacher: row.classTeacher
      ? {
          membershipId: row.classTeacher.id,
          name: row.classTeacher.user.name,
          active: row.classTeacher.status === 'ACTIVE',
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The editable fields, in the order the audit row lists them. */
const SECTION_FIELDS = [
  'name',
  'capacity',
  'streamId',
  'roomId',
  'classTeacherMembershipId',
] as const;

/** A reference in the request body that names nothing in this school: 422 on that field. */
const unknownRef = (path: string, message: string) =>
  new UnprocessableEntityException({ message, errors: [{ path, message }] });

/**
 * A stream, room, year or campus deleted between the checks and the write (foreign key 23503):
 * a 422 to reload, not a 500.
 */
const REFERENCE_GONE = {
  foreignKeyProblem: () =>
    new UnprocessableEntityException({
      message: 'Something this section uses was just removed. Reload and try again.',
    }),
};

/** The fields of a section as the audit row records them. */
const auditFields = (row: {
  academicYearId: string;
  campusId: string;
  classLevel: ClassLevel;
  name: string;
  capacity: number;
  streamId: string | null;
  roomId: string | null;
  classTeacherMembershipId: string | null;
}) => ({
  academicYearId: row.academicYearId,
  campusId: row.campusId,
  classLevel: row.classLevel,
  name: row.name,
  capacity: row.capacity,
  streamId: row.streamId,
  roomId: row.roomId,
  classTeacherMembershipId: row.classTeacherMembershipId,
});

/**
 * Sections (academics spec section 6, "Sections"). Every write runs in one `withTenant`
 * transaction with its audit row, and first takes the school's section lock (Part 4's advisory
 * lock pattern) so the class-teacher and limit checks cannot race. The database backs each rule
 * (unique names, one section per teacher per year, the room on the section's campus, no stream
 * on a junior class); the service checks them first to answer with the typed problems.
 */
@Injectable()
export class SectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The sections of a year and campus, by class level, then name; 404 for an unknown either. */
  list(auth: Actor, yearId: string, campusId: string): Promise<SectionsResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      await this.loadYear(tx, yearId);
      await this.assertCampus(tx, campusId);
      const range = await ClassRange.load(tx, auth.tenantId);
      const rows = await tx.section.findMany({
        where: { academicYearId: yearId, campusId },
        include: SECTION_INCLUDE,
        orderBy: [{ classLevel: 'asc' }, { name: 'asc' }],
      });
      return { sections: rows.map((row) => toSection(row, range)) };
    });
  }

  /** Creates one section with one `section.created` row. */
  create(auth: Actor, input: CreateSectionRequest, meta: AuditMeta): Promise<Section> {
    return academicsWrite(
      this.prisma,
      auth.tenantId,
      async (tx) => {
        await AcademicsLimits.lock(tx, 'sections', auth.tenantId);
        await this.writableYear(tx, input.academicYearId);
        await this.assertCampus(tx, input.campusId);
        const range = await ClassRange.load(tx, auth.tenantId);
        ClassRange.assertWritable(range, input.classLevel);
        const streamId = input.streamId ?? null;
        const roomId = input.roomId ?? null;
        const teacherId = input.classTeacherMembershipId ?? null;
        await this.checkStream(tx, input.classLevel, streamId, null);
        if (roomId !== null) await this.checkRoom(tx, input.campusId, roomId);
        if (teacherId !== null) await this.checkTeacher(tx, input.academicYearId, teacherId, null);
        await AcademicsLimits.assertBelow(tx, 'sections', auth.tenantId, {
          academicYearId: input.academicYearId,
          campusId: input.campusId,
        });
        const row = await tx.section.create({
          data: {
            tenantId: auth.tenantId,
            academicYearId: input.academicYearId,
            campusId: input.campusId,
            classLevel: input.classLevel,
            name: input.name,
            capacity: input.capacity,
            streamId,
            roomId,
            classTeacherMembershipId: teacherId,
          },
          include: SECTION_INCLUDE,
        });
        await this.audit.record(tx, {
          tenantId: auth.tenantId,
          action: 'section.created',
          targetType: 'section',
          targetId: row.id,
          after: auditFields(row),
          actor: auth,
          meta,
        });
        return toSection(row, range);
      },
      REFERENCE_GONE,
    );
  }

  /**
   * Edits a section of a year that is not closed and a class inside the profile range. The rules
   * apply to the section as it will be: a senior section without a stream is refused while the
   * school has an active stream, even when the edit does not touch the stream. A room, stream
   * or teacher the section already has is kept as is (an archived room or stream, an inactive
   * teacher); a newly chosen one must qualify. No change writes nothing.
   */
  update(auth: Actor, id: string, input: UpdateSectionRequest, meta: AuditMeta): Promise<Section> {
    return academicsWrite(
      this.prisma,
      auth.tenantId,
      async (tx) => {
        await AcademicsLimits.lock(tx, 'sections', auth.tenantId);
        const current = await this.load(tx, id);
        await this.writableYear(tx, current.academicYearId);
        const range = await ClassRange.load(tx, auth.tenantId);
        ClassRange.assertWritable(range, current.classLevel);

        const streamId = input.streamId === undefined ? current.streamId : input.streamId;
        await this.checkStream(tx, current.classLevel, streamId, current.streamId);
        const { roomId, classTeacherMembershipId: teacherId } = input;
        if (roomId != null && roomId !== current.roomId) {
          await this.checkRoom(tx, current.campusId, roomId);
        }
        if (teacherId != null && teacherId !== current.classTeacherMembershipId) {
          await this.checkTeacher(tx, current.academicYearId, teacherId, id);
        }

        const { before, after } = changedFields(SECTION_FIELDS, current, input);
        if (Object.keys(after).length === 0) return toSection(current, range);
        const row = await tx.section.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
            ...(input.streamId !== undefined ? { streamId: input.streamId } : {}),
            ...(roomId !== undefined ? { roomId } : {}),
            ...(teacherId !== undefined ? { classTeacherMembershipId: teacherId } : {}),
          },
          include: SECTION_INCLUDE,
        });
        await this.audit.record(tx, {
          tenantId: auth.tenantId,
          action: 'section.updated',
          targetType: 'section',
          targetId: id,
          before,
          after,
          actor: auth,
          meta,
        });
        return toSection(row, range);
      },
      REFERENCE_GONE,
    );
  }

  /** Deletes a section of a year that is not closed (even outside the profile range). */
  remove(auth: Actor, id: string, meta: AuditMeta): Promise<void> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      await AcademicsLimits.lock(tx, 'sections', auth.tenantId);
      const current = await this.load(tx, id);
      await this.writableYear(tx, current.academicYearId);
      await tx.section.delete({ where: { id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'section.deleted',
        targetType: 'section',
        targetId: id,
        before: auditFields(current),
        actor: auth,
        meta,
      });
    });
  }

  /**
   * Copies the sections of the previous year (the latest whose `ends_on` is before this year's
   * `starts_on`) on the same campus into this year, which must have none there. A room, teacher
   * or stream that no longer qualifies is dropped and reported (`planCopyForward`). One
   * `sections.copied` row (target: the year) records the result.
   */
  copyFromPrevious(
    auth: Actor,
    input: CopySectionsRequest,
    meta: AuditMeta,
  ): Promise<CopySectionsResponse> {
    return academicsWrite(this.prisma, auth.tenantId, async (tx) => {
      await AcademicsLimits.lock(tx, 'sections', auth.tenantId);
      const target = await this.writableYear(tx, input.yearId);
      await this.assertCampus(tx, input.campusId);
      const range = await ClassRange.load(tx, auth.tenantId);
      if (range.lowest === null || range.highest === null) throw new ClassesNotSetException();
      const where = { academicYearId: target.id, campusId: input.campusId };
      if ((await tx.section.count({ where })) > 0) throw new SectionsExistException();

      const source = await tx.academicYear.findFirst({
        where: { endsOn: { lt: target.startsOn } },
        orderBy: { endsOn: 'desc' },
      });
      const rows = source
        ? await tx.section.findMany({
            where: { academicYearId: source.id, campusId: input.campusId },
            orderBy: [{ classLevel: 'asc' }, { name: 'asc' }],
          })
        : [];
      if (!source || rows.length === 0) throw new NothingToCopyException();

      const [rooms, members, taken, streams] = await Promise.all([
        tx.room.findMany({
          where: { campusId: input.campusId, status: 'ACTIVE' },
          select: { id: true },
        }),
        tx.membership.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
        tx.section.findMany({
          where: { academicYearId: target.id, classTeacherMembershipId: { not: null } },
          select: { classTeacherMembershipId: true },
        }),
        tx.stream.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
      ]);
      const plan = planCopyForward(
        rows.map((r) => ({
          campusId: r.campusId,
          classLevel: r.classLevel,
          name: r.name,
          capacity: r.capacity,
          streamId: r.streamId,
          roomId: r.roomId,
          classTeacherMembershipId: r.classTeacherMembershipId,
        })),
        {
          activeRoomIds: new Set(rooms.map((r) => r.id)),
          activeMemberIds: new Set(members.map((m) => m.id)),
          takenTeacherIds: new Set(taken.map((s) => s.classTeacherMembershipId!)),
          activeStreamIds: new Set(streams.map((s) => s.id)),
        },
      );

      await AcademicsLimits.assertBelow(tx, 'sections', auth.tenantId, {
        ...where,
        adding: plan.create.length,
      });
      await tx.section.createMany({
        data: plan.create.map((r) => ({
          ...r,
          tenantId: auth.tenantId,
          academicYearId: target.id,
        })),
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        action: 'sections.copied',
        targetType: 'academic_year',
        targetId: target.id,
        after: {
          campusId: input.campusId,
          fromYearId: source.id,
          created: plan.create.length,
          dropped: plan.dropped,
        },
        actor: auth,
        meta,
      });
      return { created: plan.create.length, dropped: plan.dropped };
    });
  }

  /**
   * The school's active members for the class-teacher picker, by name, each with the name of
   * the section they already lead in the year (any campus), or null.
   */
  classTeacherOptions(auth: Actor, yearId: string): Promise<ClassTeacherOptionsResponse> {
    return withTenant(this.prisma, auth.tenantId, async (tx) => {
      await this.loadYear(tx, yearId);
      const [members, leading] = await Promise.all([
        tx.membership.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, user: { select: { name: true } } },
        }),
        tx.section.findMany({
          where: { academicYearId: yearId, classTeacherMembershipId: { not: null } },
          select: { name: true, classTeacherMembershipId: true },
        }),
      ]);
      const leads = new Map(leading.map((s) => [s.classTeacherMembershipId!, s.name]));
      const teachers = members
        .map((m) => ({
          membershipId: m.id,
          name: m.user.name,
          sectionName: leads.get(m.id) ?? null,
        }))
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.membershipId.localeCompare(b.membershipId),
        );
      return { teachers };
    });
  }

  /* -------------------------------- Checks -------------------------------- */

  /**
   * A junior class has no stream. A senior class needs one while the school has an active
   * stream. A stream other than the section's current one must be active.
   */
  private async checkStream(
    tx: Prisma.TransactionClient,
    level: ClassLevel,
    streamId: string | null,
    currentStreamId: string | null,
  ): Promise<void> {
    if (!isSeniorClass(level)) {
      if (streamId !== null) throw new StreamNotAllowedException();
      return;
    }
    if (streamId === null) {
      if ((await tx.stream.count({ where: { status: 'ACTIVE' } })) > 0) {
        throw new StreamRequiredException();
      }
      return;
    }
    if (streamId === currentStreamId) return;
    const stream = await tx.stream.findUnique({ where: { id: streamId } });
    if (!stream) throw unknownRef('streamId', 'No such stream in this school.');
    if (stream.status !== 'ACTIVE') throw new StreamArchivedException();
  }

  /** A newly chosen room must be this school's, on the section's campus, and active. */
  private async checkRoom(
    tx: Prisma.TransactionClient,
    campusId: string,
    roomId: string,
  ): Promise<void> {
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room) throw unknownRef('roomId', 'No such room in this school.');
    if (room.campusId !== campusId) throw new RoomCampusMismatchException();
    if (room.status !== 'ACTIVE') throw new RoomArchivedException();
  }

  /**
   * A newly chosen class teacher must be an active member of this school who leads no other
   * section in the year (`exceptSectionId` is the section being edited).
   */
  private async checkTeacher(
    tx: Prisma.TransactionClient,
    yearId: string,
    membershipId: string,
    exceptSectionId: string | null,
  ): Promise<void> {
    const member = await tx.membership.findUnique({ where: { id: membershipId } });
    if (!member || member.status !== 'ACTIVE') throw new TeacherUnavailableException();
    const other = await tx.section.findFirst({
      where: {
        academicYearId: yearId,
        classTeacherMembershipId: membershipId,
        ...(exceptSectionId ? { id: { not: exceptSectionId } } : {}),
      },
      select: { name: true },
    });
    if (other) throw new TeacherTakenException(other.name);
  }

  /* -------------------------------- Loads --------------------------------- */

  /** The section in the current school (row-level security narrows the query), or 404. */
  private async load(tx: Prisma.TransactionClient, id: string): Promise<SectionRow> {
    const row = isUuid(id)
      ? await tx.section.findUnique({ where: { id }, include: SECTION_INCLUDE })
      : null;
    if (!row) throw notFound('Section');
    return row;
  }

  /** The academic year of the current school, or 404. */
  private async loadYear(tx: Prisma.TransactionClient, id: string): Promise<YearRow> {
    const row = isUuid(id) ? await tx.academicYear.findUnique({ where: { id } }) : null;
    if (!row) throw notFound('Academic year');
    return row;
  }

  /** The academic year, unless it is CLOSED (409 `academic-year-locked`, Part 4's problem). */
  private async writableYear(tx: Prisma.TransactionClient, id: string): Promise<YearRow> {
    const year = await this.loadYear(tx, id);
    if (year.status === 'CLOSED') throw new AcademicYearLockedException();
    return year;
  }

  /** 404 unless the campus belongs to the current school. */
  private async assertCampus(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const campus = isUuid(id) ? await tx.campus.findUnique({ where: { id } }) : null;
    if (!campus) throw notFound('Campus');
  }
}
