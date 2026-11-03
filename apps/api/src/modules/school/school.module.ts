import { Module } from '@nestjs/common';

import { FilesModule } from '../../core/files/files.module';
import { IamModule } from '../iam/iam.module';
import { AcademicYearsController } from './academic-years.controller';
import { AcademicYearsService } from './academic-years.service';
import { CampusesController } from './campuses.controller';
import { CampusesService } from './campuses.service';
import { LogoController } from './logo.controller';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SchoolLimits } from './school-limits';

/**
 * The school's own settings: profile, logo, academic years, campuses and the onboarding
 * checklist (onboarding spec sections 5-9).
 */
@Module({
  imports: [FilesModule, IamModule],
  controllers: [
    ProfileController,
    LogoController,
    AcademicYearsController,
    CampusesController,
    OnboardingController,
  ],
  providers: [
    ProfileService,
    SchoolLimits,
    AcademicYearsService,
    CampusesService,
    OnboardingService,
  ],
  exports: [ProfileService, AcademicYearsService, CampusesService],
})
export class SchoolModule {}
