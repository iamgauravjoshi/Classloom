import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditService } from './audit.service';
import { IamLimits } from './iam-limits';
import { PermissionGuard } from './permission.guard';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Identity and access management. Import it after `AuthModule`: Nest runs global guards in
 * registration order, and `PermissionGuard` must run after `AuthGuard`.
 */
@Module({
  controllers: [RolesController],
  providers: [
    { provide: APP_GUARD, useClass: PermissionGuard },
    AuditService,
    IamLimits,
    RolesService,
  ],
  exports: [AuditService, IamLimits],
})
export class IamModule {}
