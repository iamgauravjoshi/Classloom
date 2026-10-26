import { scopeArgs } from './tenant-scope.extension';

const A = '0192d5e0-0000-7000-8000-00000000000a';
const B = '0192d5e0-0000-7000-8000-00000000000b';

describe('scopeArgs', () => {
  it.each(['findMany', 'findFirst', 'count', 'updateMany', 'deleteMany', 'groupBy'])(
    'adds tenantId to where for %s, even without a where',
    (op) => {
      expect(scopeArgs(op, undefined, A)).toEqual({ where: { tenantId: A } });
    },
  );

  it('keeps the caller where and overrides a caller tenantId', () => {
    expect(scopeArgs('findUnique', { where: { id: 'c1', tenantId: B } }, A)).toEqual({
      where: { id: 'c1', tenantId: A },
    });
  });

  it('scopes update and delete by unique key', () => {
    expect(scopeArgs('update', { where: { id: 'c1' }, data: { name: 'x' } }, A)).toEqual({
      where: { id: 'c1', tenantId: A },
      data: { name: 'x' },
    });
    expect(scopeArgs('delete', { where: { id: 'c1' } }, A)).toEqual({
      where: { id: 'c1', tenantId: A },
    });
  });

  it('sets tenantId on create, createMany and createManyAndReturn data', () => {
    expect(scopeArgs('create', { data: { name: 'x', tenantId: B } }, A)).toEqual({
      data: { name: 'x', tenantId: A },
    });
    expect(scopeArgs('createMany', { data: [{ name: 'x' }, { name: 'y' }] }, A)).toEqual({
      data: [
        { name: 'x', tenantId: A },
        { name: 'y', tenantId: A },
      ],
    });
    expect(scopeArgs('createManyAndReturn', { data: { name: 'x' } }, A)).toEqual({
      data: { name: 'x', tenantId: A },
    });
  });

  it('scopes upsert where and create', () => {
    expect(
      scopeArgs('upsert', { where: { id: 'c1' }, create: { name: 'x' }, update: { name: 'y' } }, A),
    ).toEqual({
      where: { id: 'c1', tenantId: A },
      create: { name: 'x', tenantId: A },
      update: { name: 'y' },
    });
  });

  it('throws for an operation it does not know, rather than running it unscoped', () => {
    expect(() => scopeArgs('findRaw', {}, A)).toThrow(/does not support/);
  });

  it('does not mutate the caller args', () => {
    const args = { where: { id: 'c1' } };
    scopeArgs('findUnique', args, A);
    expect(args).toEqual({ where: { id: 'c1' } });
  });
});
