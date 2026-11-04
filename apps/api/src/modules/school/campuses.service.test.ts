import { campusWriteProblem } from './campuses.service';
import { CampusNameTakenException } from './school-problems';

/** The shape Prisma 7 with @prisma/adapter-pg throws for a unique violation (P2002). */
function adapterUnique(index: string) {
  return Object.assign(new Error(`Unique constraint failed on the constraint: \`${index}\``), {
    code: 'P2002',
    meta: {
      modelName: 'Campus',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          originalMessage: `duplicate key value violates unique constraint "${index}"`,
          kind: 'UniqueConstraintViolation',
          constraint: { index },
        },
      },
    },
  });
}

describe('campusWriteProblem', () => {
  it('maps the name index to campus-name-taken', () => {
    expect(campusWriteProblem(adapterUnique('campuses_name_key'))).toBeInstanceOf(
      CampusNameTakenException,
    );
  });

  it('leaves the one-primary index unmapped (the campus lock prevents it)', () => {
    expect(campusWriteProblem(adapterUnique('campuses_one_primary'))).toBeNull();
  });

  it('ignores errors that are not unique violations', () => {
    expect(campusWriteProblem(new Error('boom'))).toBeNull();
    expect(campusWriteProblem(null)).toBeNull();
  });
});
