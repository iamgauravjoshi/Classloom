import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Audit areas (Part 6a spec §5)                                       */
/* ------------------------------------------------------------------ */

export const AUDIT_AREA_KEYS = ['people', 'school', 'calendar', 'academics', 'settings'] as const;
export type AuditArea = (typeof AUDIT_AREA_KEYS)[number];

/** Action prefixes for each area. An action belongs to the area whose prefix starts it. */
export const AUDIT_AREAS: Record<AuditArea, readonly string[]> = {
  people: ['role.', 'member.'],
  school: ['school.'],
  calendar: ['academic_year.', 'campus.'],
  academics: [
    'section.',
    'sections.',
    'stream.',
    'subject.',
    'subjects.',
    'class_subjects.',
    'house.',
    'room.',
  ],
  settings: ['number_series.', 'audit.'],
};

export function areaOfAction(action: string): AuditArea | null {
  for (const area of AUDIT_AREA_KEYS) {
    if (AUDIT_AREAS[area].some((prefix) => action.startsWith(prefix))) return area;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const auditEventsQuerySchema = z.object({
  from: dateField.optional(),
  to: dateField.optional(),
  actorUserId: z.string().max(100).optional(),
  area: z.enum(AUDIT_AREA_KEYS).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditEventsQuery = z.infer<typeof auditEventsQuerySchema>;

export const auditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  area: z.enum(AUDIT_AREA_KEYS).nullable(),
  createdAt: z.iso.datetime(),
  actor: z.object({ userId: z.string(), name: z.string() }).nullable(),
  target: z.object({ type: z.string(), id: z.string(), label: z.string().nullable() }),
  changes: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })),
  ip: z.string().nullable(),
  device: z.string().nullable(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditEventsPageSchema = z.object({
  events: z.array(auditEventSchema),
  nextCursor: z.string().nullable(),
});
export type AuditEventsPage = z.infer<typeof auditEventsPageSchema>;
