import { UnprocessableEntityException } from '@nestjs/common';

import type { PrismaService } from '../../core/prisma/prisma.service';
import { InUseException, NameTakenException } from './academics-problems';
import { academicsWrite } from './academics-write';

/** A Prisma 7 driver-adapter error with this SQLSTATE and constraint. */
const dbError = (code: string, index = '') =>
  Object.assign(new Error(`Database error. Code: \`${code}\``), {
    meta: { driverAdapterError: { cause: { originalCode: code, constraint: { index } } } },
  });

/** A PrismaService whose transaction fails with `error`. */
const failing = (error: Error) =>
  ({
    $transaction: () => {
      throw error;
    },
  }) as unknown as PrismaService;

const run = (error: Error, options?: Parameters<typeof academicsWrite>[3]) =>
  academicsWrite(failing(error), 'tenant-1', () => Promise.resolve(), options);

describe('academicsWrite', () => {
  it('maps a unique name violation to name-taken with field name', async () => {
    const error = await run(dbError('23505', 'streams_name_key')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NameTakenException);
    expect((error as NameTakenException).field).toBe('name');
  });

  it('leaves a foreign key violation alone without an option', async () => {
    const original = dbError('23503');
    await expect(run(original)).rejects.toBe(original);
  });

  it('maps a foreign key violation to in-use with inUseOnForeignKey', async () => {
    await expect(run(dbError('23503'), { inUseOnForeignKey: true })).rejects.toBeInstanceOf(
      InUseException,
    );
  });

  it('maps a foreign key violation to the given problem with foreignKeyProblem', async () => {
    const error = await run(dbError('23503'), {
      foreignKeyProblem: () => new UnprocessableEntityException('gone'),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
  });

  it('passes other errors through', async () => {
    const original = new Error('boom');
    await expect(run(original, { inUseOnForeignKey: true })).rejects.toBe(original);
  });
});
