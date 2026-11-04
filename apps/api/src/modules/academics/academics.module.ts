import { Module } from '@nestjs/common';

import { IamModule } from '../iam/iam.module';
import { ClassSubjectsController } from './class-subjects.controller';
import { ClassSubjectsService } from './class-subjects.service';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';

/**
 * The academic structure: streams, subjects and the subjects each class takes (academics spec
 * section 6). Houses, rooms and sections join in Part 5's next task.
 */
@Module({
  imports: [IamModule],
  controllers: [StreamsController, SubjectsController, ClassSubjectsController],
  providers: [StreamsService, SubjectsService, ClassSubjectsService],
})
export class AcademicsModule {}
