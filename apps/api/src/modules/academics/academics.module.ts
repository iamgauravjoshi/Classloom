import { Module } from '@nestjs/common';

import { IamModule } from '../iam/iam.module';
import { ClassSubjectsController } from './class-subjects.controller';
import { ClassSubjectsService } from './class-subjects.service';
import { HousesController } from './houses.controller';
import { HousesService } from './houses.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { SectionsController } from './sections.controller';
import { SectionsService } from './sections.service';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';

/**
 * The academic structure (academics spec section 6): streams, subjects, the subjects each class
 * takes, houses, rooms, and the sections of each academic year with copy-forward.
 */
@Module({
  imports: [IamModule],
  controllers: [
    StreamsController,
    SubjectsController,
    ClassSubjectsController,
    HousesController,
    RoomsController,
    SectionsController,
  ],
  providers: [
    StreamsService,
    SubjectsService,
    ClassSubjectsService,
    HousesService,
    RoomsService,
    SectionsService,
  ],
})
export class AcademicsModule {}
