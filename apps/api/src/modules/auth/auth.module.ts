import { BullModule } from '@nestjs/bullmq';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthGuard } from './auth.guard';
import { AUTH_MAINTENANCE_QUEUE, AuthCleanupProcessor } from './auth-cleanup.processor';
import { AuthEventsService } from './auth-events.service';
import { OriginCheckMiddleware } from './origin-check.middleware';
import { PasswordService } from './password.service';
import { SessionController } from './session.controller';
import { SessionMiddleware } from './session.middleware';
import { SessionService } from './session.service';

@Module({
  imports: [BullModule.registerQueue({ name: AUTH_MAINTENANCE_QUEUE })],
  controllers: [SessionController],
  providers: [
    SessionService,
    AuthEventsService,
    PasswordService,
    AuthCleanupProcessor,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SessionService, AuthEventsService, PasswordService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Origin first: a cross-site request is refused before any session lookup.
    consumer.apply(OriginCheckMiddleware, SessionMiddleware).forRoutes('*');
  }
}
