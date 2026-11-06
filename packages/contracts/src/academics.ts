import { z } from 'zod';

import { CLASS_LEVELS } from './school';
import type { Board } from './tenancy';

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const SUBJECT_TYPES = ['SCHOLASTIC', 'CO_SCHOLASTIC'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const ROOM_TYPES = ['CLASSROOM', 'LAB', 'COMPUTER_LAB', 'LIBRARY', 'HALL', 'OTHER'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const HOUSE_COLOURS = [
  'RED',
  'BLUE',
  'GREEN',
  'YELLOW',
  'ORANGE',
  'PURPLE',
  'PINK',
  'TEAL',
  'BROWN',
  'GREY',
] as const;
export type HouseColour = (typeof HOUSE_COLOURS)[number];

export const ACADEMIC_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type AcademicStatus = (typeof ACADEMIC_STATUSES)[number];

export const CLASS_SUBJECT_KINDS = ['COMPULSORY', 'OPTIONAL'] as const;
export type ClassSubjectKind = (typeof CLASS_SUBJECT_KINDS)[number];

/** Classes that choose a stream (spec section 3). */
export const SENIOR_CLASSES = ['XI', 'XII'] as const;

/** Offered when a school sets up streams. */
export const STARTER_STREAMS = ['Science', 'Commerce', 'Humanities'] as const;

/* ------------------------------------------------------------------ */
/* Board starter subject lists (spec section 5)                        */
/* ------------------------------------------------------------------ */

export type StarterSubject = { name: string; code?: string; type: SubjectType };

const sch = (name: string, code?: string): StarterSubject =>
  code === undefined ? { name, type: 'SCHOLASTIC' } : { name, code, type: 'SCHOLASTIC' };
const coSch = (name: string): StarterSubject => ({ name, type: 'CO_SCHOLASTIC' });

const PRIMARY: StarterSubject[] = [
  sch('English'),
  sch('Hindi'),
  sch('Mathematics'),
  sch('Environmental Studies (EVS)'),
  sch('General Knowledge'),
  sch('Computer'),
];

const CBSE_SCHOLASTIC: StarterSubject[] = [
  sch('English Language & Literature', '184'),
  sch('Hindi Course A', '002'),
  sch('Hindi Course B', '085'),
  sch('Mathematics (Standard)', '041'),
  sch('Mathematics (Basic)', '241'),
  sch('Science', '086'),
  sch('Social Science', '087'),
  sch('Information Technology', '402'),
  sch('English Core', '301'),
  sch('Physics', '042'),
  sch('Chemistry', '043'),
  sch('Biology', '044'),
  sch('Mathematics', '041'),
  sch('Computer Science', '083'),
  sch('Informatics Practices', '065'),
  sch('Economics', '030'),
  sch('Business Studies', '054'),
  sch('Accountancy', '055'),
  sch('History', '027'),
  sch('Political Science', '028'),
  sch('Geography', '029'),
  sch('Psychology', '037'),
  sch('Physical Education', '048'),
];

const GENERIC: StarterSubject[] = [
  sch('English'),
  sch('Second Language'),
  sch('Mathematics'),
  sch('Physics'),
  sch('Chemistry'),
  sch('Biology'),
  sch('History & Civics'),
  sch('Geography'),
  sch('Computer Applications'),
  sch('Economics'),
  sch('Commerce'),
];

const CO_SCHOLASTIC: StarterSubject[] = [
  coSch('Art Education'),
  coSch('Health & Physical Education'),
  coSch('Work Education'),
];

/** Names are unique per board: the first position wins, and a later code fills a missing one. */
function dedupe(list: StarterSubject[]): StarterSubject[] {
  const out: StarterSubject[] = [];
  const at = new Map<string, number>();
  for (const s of list) {
    const key = s.name.toLowerCase();
    const i = at.get(key);
    if (i === undefined) {
      at.set(key, out.length);
      out.push({ ...s });
    } else if (out[i]!.code === undefined && s.code !== undefined) {
      out[i] = { ...out[i]!, code: s.code };
    }
  }
  return out;
}

const generic = dedupe([...PRIMARY, ...GENERIC, ...CO_SCHOLASTIC]);

export const STARTER_SUBJECTS: Record<Board, readonly StarterSubject[]> = {
  CBSE: dedupe([...PRIMARY, ...CBSE_SCHOLASTIC, ...CO_SCHOLASTIC]),
  ICSE: generic,
  STATE: generic,
  IB: generic,
  CAMBRIDGE: generic,
  OTHER: generic,
};

/* ------------------------------------------------------------------ */
/* Field helpers                                                       */
/* ------------------------------------------------------------------ */

const id = z.uuid();
const nullableId = z.uuid().nullable();
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

const name = (min: number, max: number) => z.string().trim().min(min).max(max);
const classLevel = z.enum(CLASS_LEVELS);
const status = z.enum(ACADEMIC_STATUSES);
const subjectCode = nullableText(10).refine((v) => v === null || /^[A-Za-z0-9-]+$/.test(v), {
  message: 'Use letters, digits and hyphens only',
});
const timestamps = { createdAt: z.string(), updatedAt: z.string() };

/* ------------------------------------------------------------------ */
/* Streams                                                             */
/* ------------------------------------------------------------------ */

export const streamSchema = z.object({ id, name: z.string(), status, ...timestamps });
export type Stream = z.infer<typeof streamSchema>;

export const createStreamRequestSchema = z.object({ name: name(2, 40) });
export type CreateStreamRequest = z.infer<typeof createStreamRequestSchema>;
export const updateStreamRequestSchema = z.object({
  name: name(2, 40).optional(),
});
export type UpdateStreamRequest = z.infer<typeof updateStreamRequestSchema>;
export const streamsResponseSchema = z.object({ streams: z.array(streamSchema) });
export type StreamsResponse = z.infer<typeof streamsResponseSchema>;
/** `POST /academics/streams/starter`: the streams created, and the starter names that existed. */
export const starterStreamsAddedResponseSchema = z.object({
  created: z.array(streamSchema),
  skipped: z.array(z.string()),
});
export type StarterStreamsAddedResponse = z.infer<typeof starterStreamsAddedResponseSchema>;

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

export const subjectSchema = z.object({
  id,
  name: z.string(),
  code: z.string().nullable(),
  type: z.enum(SUBJECT_TYPES),
  status,
  ...timestamps,
});
export type Subject = z.infer<typeof subjectSchema>;

export const createSubjectRequestSchema = z.object({
  name: name(2, 60),
  code: subjectCode.optional(),
  type: z.enum(SUBJECT_TYPES),
});
export type CreateSubjectRequest = z.infer<typeof createSubjectRequestSchema>;
export const updateSubjectRequestSchema = z.object({
  name: name(2, 60).optional(),
  code: subjectCode.optional(),
  type: z.enum(SUBJECT_TYPES).optional(),
});
export type UpdateSubjectRequest = z.infer<typeof updateSubjectRequestSchema>;
export const subjectsResponseSchema = z.object({ subjects: z.array(subjectSchema) });
export type SubjectsResponse = z.infer<typeof subjectsResponseSchema>;

export const starterSubjectsResponseSchema = z.object({
  board: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      code: z.string().nullable(),
      type: z.enum(SUBJECT_TYPES),
      exists: z.boolean(),
    }),
  ),
});
export type StarterSubjectsResponse = z.infer<typeof starterSubjectsResponseSchema>;

export const starterSubjectsRequestSchema = z.object({
  items: z
    .array(
      z.object({ name: name(2, 60), code: subjectCode.optional(), type: z.enum(SUBJECT_TYPES) }),
    )
    .min(1)
    .max(100),
});
export type StarterSubjectsRequest = z.infer<typeof starterSubjectsRequestSchema>;
export const starterSubjectsAddedResponseSchema = z.object({
  created: z.array(subjectSchema),
  skipped: z.array(z.string()),
});
export type StarterSubjectsAddedResponse = z.infer<typeof starterSubjectsAddedResponseSchema>;

/* ------------------------------------------------------------------ */
/* Class subjects                                                      */
/* ------------------------------------------------------------------ */

export const classSubjectRowSchema = z.object({
  subjectId: id,
  streamId: nullableId,
  kind: z.enum(CLASS_SUBJECT_KINDS),
});
export type ClassSubjectRow = z.infer<typeof classSubjectRowSchema>;

/** One class's rows; outsideRange marks a class outside the profile range. */
export const classSubjectsClassSchema = z.object({
  classLevel,
  outsideRange: z.boolean(),
  rows: z.array(classSubjectRowSchema),
});
export type ClassSubjectsClass = z.infer<typeof classSubjectsClassSchema>;

/** A stream as the class-subjects grid needs it (no `classes.view` needed to read it). */
export const classSubjectsStreamSchema = z.object({ id, name: z.string(), status });
export type ClassSubjectsStream = z.infer<typeof classSubjectsStreamSchema>;

/**
 * Every row, grouped by class level; outsideRange marks classes outside the profile range.
 * `streams`: every ACTIVE stream, plus any ARCHIVED stream a row still names.
 */
export const classSubjectsResponseSchema = z.object({
  classes: z.array(classSubjectsClassSchema),
  streams: z.array(classSubjectsStreamSchema),
});
export type ClassSubjectsResponse = z.infer<typeof classSubjectsResponseSchema>;

export const replaceClassSubjectsRequestSchema = z.object({
  rows: z.array(classSubjectRowSchema).max(200),
});
export type ReplaceClassSubjectsRequest = z.infer<typeof replaceClassSubjectsRequestSchema>;

/* ------------------------------------------------------------------ */
/* Houses                                                              */
/* ------------------------------------------------------------------ */

export const houseSchema = z.object({
  id,
  name: z.string(),
  colour: z.enum(HOUSE_COLOURS),
  status,
  ...timestamps,
});
export type House = z.infer<typeof houseSchema>;

export const createHouseRequestSchema = z.object({
  name: name(2, 40),
  colour: z.enum(HOUSE_COLOURS),
});
export type CreateHouseRequest = z.infer<typeof createHouseRequestSchema>;
export const updateHouseRequestSchema = z.object({
  name: name(2, 40).optional(),
  colour: z.enum(HOUSE_COLOURS).optional(),
});
export type UpdateHouseRequest = z.infer<typeof updateHouseRequestSchema>;
export const housesResponseSchema = z.object({ houses: z.array(houseSchema) });
export type HousesResponse = z.infer<typeof housesResponseSchema>;

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */

export const roomSchema = z.object({
  id,
  campusId: id,
  name: z.string(),
  type: z.enum(ROOM_TYPES),
  capacity: z.number().int(),
  floor: z.string().nullable(),
  status,
  ...timestamps,
});
export type Room = z.infer<typeof roomSchema>;

const roomCapacity = z.number().int().min(1).max(500);

export const createRoomRequestSchema = z.object({
  campusId: id,
  name: name(1, 40),
  type: z.enum(ROOM_TYPES),
  capacity: roomCapacity,
  floor: nullableText(20).optional(),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export const updateRoomRequestSchema = z.object({
  name: name(1, 40).optional(),
  type: z.enum(ROOM_TYPES).optional(),
  capacity: roomCapacity.optional(),
  floor: nullableText(20).optional(),
});
export type UpdateRoomRequest = z.infer<typeof updateRoomRequestSchema>;
export const roomsResponseSchema = z.object({ rooms: z.array(roomSchema) });
export type RoomsResponse = z.infer<typeof roomsResponseSchema>;

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

export const sectionSchema = z.object({
  id,
  academicYearId: id,
  campusId: id,
  classLevel,
  outsideRange: z.boolean(),
  name: z.string(),
  capacity: z.number().int(),
  stream: z.object({ id, name: z.string() }).nullable(),
  room: z.object({ id, name: z.string() }).nullable(),
  classTeacher: z.object({ membershipId: id, name: z.string(), active: z.boolean() }).nullable(),
  ...timestamps,
});
export type Section = z.infer<typeof sectionSchema>;

const sectionCapacity = z.number().int().min(1).max(200);

export const createSectionRequestSchema = z.object({
  academicYearId: id,
  campusId: id,
  classLevel,
  name: name(1, 20),
  capacity: sectionCapacity,
  streamId: nullableId.optional(),
  roomId: nullableId.optional(),
  classTeacherMembershipId: nullableId.optional(),
});
export type CreateSectionRequest = z.infer<typeof createSectionRequestSchema>;
export const updateSectionRequestSchema = z.object({
  name: name(1, 20).optional(),
  capacity: sectionCapacity.optional(),
  streamId: nullableId.optional(),
  roomId: nullableId.optional(),
  classTeacherMembershipId: nullableId.optional(),
});
export type UpdateSectionRequest = z.infer<typeof updateSectionRequestSchema>;
export const sectionsResponseSchema = z.object({ sections: z.array(sectionSchema) });
export type SectionsResponse = z.infer<typeof sectionsResponseSchema>;

export const copySectionsRequestSchema = z.object({ yearId: id, campusId: id });
export type CopySectionsRequest = z.infer<typeof copySectionsRequestSchema>;
export const copySectionsResponseSchema = z.object({
  created: z.number().int().min(0),
  dropped: z.array(
    z.object({ section: z.string(), field: z.enum(['room', 'teacher', 'stream', 'class']) }),
  ),
});
export type CopySectionsResponse = z.infer<typeof copySectionsResponseSchema>;

export const classTeacherOptionsResponseSchema = z.object({
  teachers: z.array(
    z.object({
      membershipId: id,
      name: z.string(),
      /** The section they already lead in the requested year, if any. */
      sectionName: z.string().nullable(),
    }),
  ),
});
export type ClassTeacherOptionsResponse = z.infer<typeof classTeacherOptionsResponseSchema>;
