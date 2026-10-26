import { Module } from '@nestjs/common';

import { EmailModule } from '../../core/email/email.module';
import { SchoolCodeService } from './school-code.service';
import { SchoolRegistrationService } from './school-registration.service';
import { SchoolRegistrationsController } from './school-registrations.controller';
import { SchoolsController } from './schools.controller';

@Module({
  imports: [EmailModule],
  controllers: [SchoolsController, SchoolRegistrationsController],
  providers: [SchoolCodeService, SchoolRegistrationService],
  exports: [SchoolCodeService],
})
export class TenancyModule {}
