import { TenantContextMissingError } from './errors';
import { TenantContext } from './tenant-context';

const A = '0192d5e0-0000-7000-8000-00000000000a';
const B = '0192d5e0-0000-7000-8000-00000000000b';

describe('TenantContext', () => {
  const ctx = new TenantContext();

  it('has no tenant outside run', () => {
    expect(ctx.current()).toBeUndefined();
  });

  it('require() outside run throws TenantContextMissingError', () => {
    expect(() => ctx.require()).toThrow(TenantContextMissingError);
  });

  it('exposes the tenant inside run, including across awaits', async () => {
    const seen = await ctx.run(A, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return ctx.require();
    });
    expect(seen).toBe(A);
    expect(ctx.current()).toBeUndefined();
  });

  it('isolates concurrent runs', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 1));
    const [a, b] = await Promise.all([
      ctx.run(A, async () => (await tick(), ctx.current())),
      ctx.run(B, async () => (await tick(), ctx.current())),
    ]);
    expect([a, b]).toEqual([A, B]);
  });

  it('rejects an empty tenant id', () => {
    expect(() => ctx.run('', () => 1)).toThrow(TenantContextMissingError);
  });
});

describe('TenantContext with lazy thenables (like PrismaPromise)', () => {
  const ctx = new TenantContext();
  const lazy = () => ({
    then<R>(resolve: (value: string | undefined) => R) {
      return Promise.resolve(ctx.current()).then(resolve);
    },
  });

  it('starts a thenable returned by fn inside the tenant context', async () => {
    await expect(ctx.run(A, lazy)).resolves.toBe(A);
  });

  it('does not run a returned thenable under an outer tenant', async () => {
    const seen = await ctx.run(B, async () => await ctx.run(A, lazy));
    expect(seen).toBe(A);
  });
});
