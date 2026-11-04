import {
  ACADEMIC_STATUSES,
  CLASS_SUBJECT_KINDS,
  HOUSE_COLOURS,
  ROOM_TYPES,
  SUBJECT_TYPES,
} from '@classloom/contracts';

import {
  AcademicStatus,
  ClassSubjectKind,
  HouseColour,
  RoomType,
  SubjectType,
} from '../../generated/prisma/enums';

// The Prisma enums are declared in prisma/schema/academics.prisma; their values must equal the
// contract lists the API validates against.
describe('academics enums match @classloom/contracts', () => {
  it('SubjectType equals SUBJECT_TYPES', () => {
    expect(Object.values(SubjectType)).toEqual([...SUBJECT_TYPES]);
  });

  it('RoomType equals ROOM_TYPES', () => {
    expect(Object.values(RoomType)).toEqual([...ROOM_TYPES]);
  });

  it('HouseColour equals HOUSE_COLOURS', () => {
    expect(Object.values(HouseColour)).toEqual([...HOUSE_COLOURS]);
  });

  it('AcademicStatus equals ACADEMIC_STATUSES', () => {
    expect(Object.values(AcademicStatus)).toEqual([...ACADEMIC_STATUSES]);
  });

  it('ClassSubjectKind equals CLASS_SUBJECT_KINDS', () => {
    expect(Object.values(ClassSubjectKind)).toEqual([...CLASS_SUBJECT_KINDS]);
  });
});
