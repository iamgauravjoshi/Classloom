import { describe, expect, it } from 'vitest';

import {
  areaOfAction,
  AUDIT_AREAS,
  auditEventSchema,
  auditEventsPageSchema,
  auditEventsQuerySchema,
} from './audit';

describe('areaOfAction', () => {
  it('maps actions to areas by prefix', () => {
    expect(areaOfAction('class_subjects.updated')).toBe('academics');
    expect(areaOfAction('number_series.updated')).toBe('settings');
    expect(areaOfAction('audit.exported')).toBe('settings');
    expect(areaOfAction('role.created')).toBe('people');
    expect(areaOfAction('campus.updated')).toBe('calendar');
    expect(areaOfAction('school.updated')).toBe('school');
    expect(areaOfAction('mystery.thing')).toBeNull();
  });

  it('does not match a prefix without its dot', () => {
    expect(areaOfAction('schoolish.x')).toBeNull();
    expect(Object.keys(AUDIT_AREAS)).toHaveLength(5);
  });
});

describe('auditEventsQuerySchema', () => {
  it('defaults the limit to 50 and bounds it', () => {
    expect(auditEventsQuerySchema.parse({}).limit).toBe(50);
    expect(auditEventsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(auditEventsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(auditEventsQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  });

  it('checks dates and areas', () => {
    expect(auditEventsQuerySchema.safeParse({ from: '2026-11-06', to: '2026-11-07' }).success).toBe(
      true,
    );
    expect(auditEventsQuerySchema.safeParse({ from: '06/11/2026' }).success).toBe(false);
    expect(auditEventsQuerySchema.safeParse({ area: 'settings' }).success).toBe(true);
    expect(auditEventsQuerySchema.safeParse({ area: 'nope' }).success).toBe(false);
  });
});

describe('event schemas', () => {
  it('accepts a page', () => {
    const event = {
      id: 'e1',
      action: 'number_series.updated',
      area: 'settings',
      createdAt: '2026-11-06T10:00:00.000Z',
      actor: { userId: 'u1', name: 'Asha' },
      target: { type: 'number_series', id: 't1', label: null },
      changes: [{ field: 'pattern', before: 'A', after: 'B' }],
      ip: null,
      device: null,
    };
    expect(auditEventSchema.safeParse(event).success).toBe(true);
    expect(auditEventsPageSchema.safeParse({ events: [event], nextCursor: null }).success).toBe(
      true,
    );
  });
});
