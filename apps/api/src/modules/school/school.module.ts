import { Module } from '@nestjs/common';

import { FilesModule } from '../../core/files/files.module';
import { IamModule } from '../iam/iam.module';
import { LogoController } from './logo.controller';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SchoolLimits } from './school-limits';

/** The school's own settings: profile and logo (onboarding spec sections 5 and 8). */
@Module({
  imports: [FilesModule, IamModule],
  controllers: [ProfileController, LogoController],
  providers: [ProfileService, SchoolLimits],
  exports: [ProfileService],
})
export class SchoolModule {}
