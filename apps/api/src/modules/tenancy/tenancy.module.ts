import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { EmailModule } from '../../core/email/email.module';
import { ResendVerificationProcessor } from './resend-verification.processor';
import { SchoolCodeService } from './school-code.service';
import { REGISTRATION_QUEUE, SchoolRegistrationService } from './school-registration.service';
import { SchoolRegistrationsController } from './school-registrations.controller';
import { SchoolsController } from './schools.controller';

@Module({
  imports: [EmailModule, BullModule.registerQueue({ name: REGISTRATION_QUEUE })],
  controllers: [SchoolsController, SchoolRegistrationsController],
  providers: [SchoolCodeService, SchoolRegistrationService, ResendVerificationProcessor],
  exports: [SchoolCodeService],
})
export class TenancyModule {}
