import { yearWriteProblem } from './academic-years.service';
import {
  AcademicYearLabelTakenException,
  AcademicYearOverlapException,
  AcademicYearPlannedExistsException,
} from './school-problems';

/** The shape Prisma 7 with @prisma/adapter-pg throws for a unique violation (P2002). */
function adapterUnique(index: string) {
  return Object.assign(new Error(`Unique constraint failed on the constraint: \`${index}\``), {
    code: 'P2002',
    meta: {
      modelName: 'AcademicYear',
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

describe('yearWriteProblem', () => {
  it('maps the planned-year index to academic-year-planned-exists', () => {
    expect(yearWriteProblem(adapterUnique('academic_years_one_planned'))).toBeInstanceOf(
      AcademicYearPlannedExistsException,
    );
  });

  it('maps the label index to academic-year-label-taken', () => {
    expect(yearWriteProblem(adapterUnique('academic_years_label_key'))).toBeInstanceOf(
      AcademicYearLabelTakenException,
    );
  });

  it('reads meta.target when the client reports it there', () => {
    const error = { code: 'P2002', meta: { target: 'academic_years_label_key' }, message: '' };
    expect(yearWriteProblem(error)).toBeInstanceOf(AcademicYearLabelTakenException);
  });

  it('reads meta.constraint when the client reports it there', () => {
    const error = { code: 'P2002', meta: { constraint: 'academic_years_one_planned' } };
    expect(yearWriteProblem(error)).toBeInstanceOf(AcademicYearPlannedExistsException);
  });

  it('falls back to the message when meta names no constraint', () => {
    const error = Object.assign(
      new Error('Unique constraint failed on the constraint: `academic_years_label_key`'),
      { code: 'P2002', meta: {} },
    );
    expect(yearWriteProblem(error)).toBeInstanceOf(AcademicYearLabelTakenException);
  });

  it('maps an exclusion violation (23P01) to academic-year-overlap', () => {
    const error = Object.assign(new Error('Database error. Code: `23P01`. Message: `...`'), {
      code: 'P2039',
      meta: {
        driverAdapterError: {
          cause: {
            kind: 'postgres',
            originalCode: '23P01',
            originalMessage:
              'conflicting key value violates exclusion constraint "academic_years_no_overlap"',
          },
        },
      },
    });
    expect(yearWriteProblem(error)).toBeInstanceOf(AcademicYearOverlapException);
  });

  it('maps 23P01 named only in the message', () => {
    const error = new Error('Database error. Code: `23P01`. Message: `conflicting key value`');
    expect(yearWriteProblem(error)).toBeInstanceOf(AcademicYearOverlapException);
  });

  it('leaves other unique violations and other errors alone', () => {
    expect(yearWriteProblem(adapterUnique('academic_terms_academic_year_id_seq_key'))).toBeNull();
    expect(yearWriteProblem(new Error('boom'))).toBeNull();
    expect(yearWriteProblem(null)).toBeNull();
    expect(
      yearWriteProblem({ code: 'P2003', meta: { target: 'academic_years_label_key' } }),
    ).toBeNull();
  });
});
