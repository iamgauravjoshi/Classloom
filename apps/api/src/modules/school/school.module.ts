import { Module } from '@nestjs/common';

import { FilesModule } from '../../core/files/files.module';
import { IamModule } from '../iam/iam.module';
import { AcademicYearsController } from './academic-years.controller';
import { AcademicYearsService } from './academic-years.service';
import { LogoController } from './logo.controller';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SchoolLimits } from './school-limits';

/** The school's own settings: profile, logo and academic years (onboarding spec sections 5, 6, 8). */
@Module({
  imports: [FilesModule, IamModule],
  controllers: [ProfileController, LogoController, AcademicYearsController],
  providers: [ProfileService, SchoolLimits, AcademicYearsService],
  exports: [ProfileService, AcademicYearsService],
})
export class SchoolModule {}
