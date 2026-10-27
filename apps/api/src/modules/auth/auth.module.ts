import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AUTH_MAINTENANCE_QUEUE, AuthCleanupProcessor } from './auth-cleanup.processor';
import { AuthEventsService } from './auth-events.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Module({
  imports: [BullModule.registerQueue({ name: AUTH_MAINTENANCE_QUEUE })],
  providers: [SessionService, AuthEventsService, PasswordService, AuthCleanupProcessor],
  exports: [SessionService, AuthEventsService, PasswordService],
})
export class AuthModule {}
