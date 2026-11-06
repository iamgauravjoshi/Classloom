import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

interface Doc {
  components: { schemas: Record<string, { properties: Record<string, unknown> }> };
}
const doc = JSON.parse(readFileSync(path.join(__dirname, '../openapi.json'), 'utf8')) as Doc;
const property = (schema: string, name: string) => doc.components.schemas[schema]!.properties[name];

describe('openapi.json nullable properties', () => {
  // A top-level nullable string without withNullableProperties is read by swagger as string[].
  it.each([
    ['MembersPageDto', 'nextCursor'],
    ['InvitationDto', 'invitedBy'],
    ['LoginActivityPageDto', 'nextCursor'],
    ['AuditEventsPageDto', 'nextCursor'],
  ])('describes %s.%s as a nullable string, not an array', (schema, name) => {
    expect(property(schema, name)).toEqual({ type: ['string', 'null'] });
  });
});
