import { describe, expect, it } from 'vitest';

import { restoreNullable, withNullableProperties } from './nullable-openapi';

describe('nullable OpenAPI properties', () => {
  const dto = (properties: Record<string, unknown>) => {
    class Dto {
      static _OPENAPI_METADATA_FACTORY(): Record<string, unknown> {
        return properties;
      }
    }
    return withNullableProperties(Dto);
  };

  it('hands swagger a plain type with a marker, and leaves other properties alone', () => {
    expect(
      dto({
        mobile: { type: ['string', 'null'] },
        name: { type: 'string', minLength: 2 },
      })._OPENAPI_METADATA_FACTORY(),
    ).toEqual({
      mobile: { type: 'string', 'x-nullable': true },
      name: { type: 'string', minLength: 2 },
    });
  });

  it('turns the marker back into a 3.1 nullable type anywhere in the document', () => {
    const document = {
      components: {
        schemas: { Me: { properties: { mobile: { type: 'string', 'x-nullable': true } } } },
      },
    };
    expect(restoreNullable(document)).toEqual({
      components: { schemas: { Me: { properties: { mobile: { type: ['string', 'null'] } } } } },
    });
  });
});
