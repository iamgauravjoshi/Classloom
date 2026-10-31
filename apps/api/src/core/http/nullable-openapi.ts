/**
 * nestjs-zod describes a top-level `z.string().nullable()` as `type: ['string', 'null']`, which
 * `@nestjs/swagger` reads as an array of strings (and `anyOf` there crashes it). The DTO wrapper
 * hands swagger a plain `type` plus a marker, and `restoreNullable` turns the marker back into
 * the OpenAPI 3.1 form once the document is built.
 */
const MARKER = 'x-nullable';
type Schema = Record<string, unknown>;

function fixSchema(schema: Schema): Schema {
  const { type, ...rest } = schema;
  if (Array.isArray(type) && type.includes('null')) {
    const others = (type as unknown[]).filter((entry) => entry !== 'null');
    return { ...rest, type: others.length === 1 ? others[0] : others, [MARKER]: true };
  }
  return schema;
}

type DtoClass = abstract new (...args: never[]) => unknown;
type MetadataFactory = (this: unknown) => Record<string, unknown>;

/** Wraps a `createZodDto` class so its top-level nullable properties survive `SwaggerModule`. */
export function withNullableProperties<T extends DtoClass>(dto: T): T {
  const holder = dto as unknown as { _OPENAPI_METADATA_FACTORY: MetadataFactory };
  const original = holder._OPENAPI_METADATA_FACTORY;
  holder._OPENAPI_METADATA_FACTORY = function (this: unknown) {
    const properties = original.call(this);
    return Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        value && typeof value === 'object' ? fixSchema(value as Schema) : value,
      ]),
    );
  };
  return dto;
}

/** Rewrites every marked schema in `document` to `type: [..., 'null']` (OpenAPI 3.1). */
export function restoreNullable<T>(document: T): T {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const schema = node as Schema;
    if (schema[MARKER] === true) {
      delete schema[MARKER];
      schema.type = [
        ...(Array.isArray(schema.type) ? (schema.type as unknown[]) : [schema.type]),
        'null',
      ];
    }
    Object.values(schema).forEach(walk);
  };
  walk(document);
  return document;
}
