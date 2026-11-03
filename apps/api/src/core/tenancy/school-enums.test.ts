import {
  ACADEMIC_YEAR_STATUSES,
  CLASS_LEVELS,
  RESIDENTIAL,
  SCHOOL_TYPES,
} from '@classloom/contracts';

import {
  AcademicYearStatus,
  ClassLevel,
  Residential,
  SchoolType,
} from '../../generated/prisma/enums';

// The Prisma enums are declared in prisma/schema/school.prisma; their values (and, for
// ClassLevel, their order, which the `lowest_class <= highest_class` CHECK relies on) must equal
// the contract lists the API validates against.
describe('school enums match @classloom/contracts', () => {
  it('ClassLevel equals CLASS_LEVELS, in order', () => {
    expect(Object.values(ClassLevel)).toEqual([...CLASS_LEVELS]);
  });

  it('SchoolType equals SCHOOL_TYPES', () => {
    expect(Object.values(SchoolType)).toEqual([...SCHOOL_TYPES]);
  });

  it('Residential equals RESIDENTIAL', () => {
    expect(Object.values(Residential)).toEqual([...RESIDENTIAL]);
  });

  it('AcademicYearStatus equals ACADEMIC_YEAR_STATUSES', () => {
    expect(Object.values(AcademicYearStatus)).toEqual([...ACADEMIC_YEAR_STATUSES]);
  });
});
