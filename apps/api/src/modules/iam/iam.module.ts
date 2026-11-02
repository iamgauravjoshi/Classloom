import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { PermissionGuard } from './permission.guard';

/**
 * Identity and access management. Import it after `AuthModule`: Nest runs global guards in
 * registration order, and `PermissionGuard` must run after `AuthGuard`.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
export class IamModule {}
