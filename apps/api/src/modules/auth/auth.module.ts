import { BullModule } from '@nestjs/bullmq';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { EmailModule } from '../../core/email/email.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AuthGuard } from './auth.guard';
import { AuthProcessor } from './auth.processor';
import { AUTH_MAINTENANCE_QUEUE, AuthCleanupProcessor } from './auth-cleanup.processor';
import { AuthEventsService } from './auth-events.service';
import { AUTH_QUEUE, EmailCodeService } from './email-code.service';
import { KnownDeviceService } from './known-device.service';
import { OriginCheckMiddleware } from './origin-check.middleware';
import { PasswordController } from './password.controller';
import { PasswordService } from './password.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordSignInService } from './password-sign-in.service';
import { SessionController } from './session.controller';
import { SessionMiddleware } from './session.middleware';
import { SessionService } from './session.service';
import { SignInController } from './sign-in.controller';
import { SignInPauseService } from './sign-in-pause.service';

@Module({
  imports: [
    EmailModule,
    BullModule.registerQueue({ name: AUTH_MAINTENANCE_QUEUE }, { name: AUTH_QUEUE }),
  ],
  controllers: [SessionController, SignInController, PasswordController, AccountController],
  providers: [
    SessionService,
    KnownDeviceService,
    AuthEventsService,
    PasswordService,
    SignInPauseService,
    PasswordSignInService,
    EmailCodeService,
    PasswordResetService,
    AccountService,
    AuthProcessor,
    AuthCleanupProcessor,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [
    SessionService,
    KnownDeviceService,
    AuthEventsService,
    PasswordService,
    SignInPauseService,
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Origin first: a cross-site request is refused before any session lookup.
    consumer.apply(OriginCheckMiddleware, SessionMiddleware).forRoutes('*');
  }
}
