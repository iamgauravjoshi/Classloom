import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { EmailModule } from '../../core/email/email.module';
import { AuthModule } from '../auth/auth.module';
import { AuditService } from './audit.service';
import { IamLimits } from './iam-limits';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PermissionGuard } from './permission.guard';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Identity and access management. Import it after `AuthModule`: Nest runs global guards in
 * registration order, and `PermissionGuard` must run after `AuthGuard`.
 */
@Module({
  imports: [AuthModule, EmailModule],
  controllers: [RolesController, MembersController],
  providers: [
    { provide: APP_GUARD, useClass: PermissionGuard },
    AuditService,
    IamLimits,
    RolesService,
    MembersService,
  ],
  exports: [AuditService, IamLimits],
})
export class IamModule {}
