import {
  createRoleRequestSchema,
  type PermissionCatalogueResponse,
  permissionCatalogueResponseSchema,
  type Role,
  roleSchema,
  type RolesResponse,
  rolesResponseSchema,
  updateRoleRequestSchema,
} from '@classloom/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';

import { withNullableProperties } from '../../core/http/nullable-openapi';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { RequirePermission } from './require-permission.decorator';
import { RolesService } from './roles.service';

class RoleDto extends withNullableProperties(createZodDto(roleSchema)) {}
class RolesResponseDto extends createZodDto(rolesResponseSchema) {}
class PermissionCatalogueDto extends createZodDto(permissionCatalogueResponseSchema) {}
class CreateRoleRequestDto extends createZodDto(createRoleRequestSchema) {}
class UpdateRoleRequestDto extends createZodDto(updateRoleRequestSchema) {}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@ApiTags('iam')
@ApiCookieAuth()
@Controller('iam')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @RequirePermission('iam.view')
  @ApiOperation({ operationId: 'listRoles', summary: "The school's roles with their permissions" })
  @ApiOkResponse({ type: RolesResponseDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs iam.view (type permission-denied)' })
  list(): Promise<RolesResponse> {
    return this.roles.list();
  }

  @Get('permissions')
  @RequirePermission('iam.view')
  @ApiOperation({ operationId: 'listPermissions', summary: 'The permission catalogue' })
  @ApiOkResponse({ type: PermissionCatalogueDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs iam.view (type permission-denied)' })
  permissions(): PermissionCatalogueResponse {
    return this.roles.catalogue();
  }

  @Post('roles')
  @RequirePermission('iam.manage')
  @ApiOperation({
    operationId: 'createRole',
    summary: 'Create a custom role, optionally as a copy of another; 60 changes per hour',
  })
  @ApiCreatedResponse({ type: RoleDto })
  @ApiBadRequestResponse({ description: 'The name or an unknown permission key is not valid' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({
    description: 'Needs iam.manage, or grants a permission you lack (type permission-denied)',
  })
  @ApiNotFoundResponse({ description: 'The role to copy does not exist' })
  @ApiConflictResponse({ description: 'The name is taken (errors[] path name)' })
  @ApiTooManyRequestsResponse({ description: 'More than 60 changes in an hour' })
  create(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CreateRoleRequestDto,
    @Req() req: Request,
  ): Promise<Role> {
    return this.roles.create(auth, body, meta(req));
  }

  @Put('roles/:id')
  @RequirePermission('iam.manage')
  @ApiOperation({
    operationId: 'updateRole',
    summary: 'Change a role; a built-in role keeps its name and Owner only its two-step setting',
  })
  @ApiOkResponse({ type: RoleDto })
  @ApiBadRequestResponse({ description: 'Not valid, or the change is not allowed for this role' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({
    description:
      'Needs iam.manage, changes a permission you lack, or an owner-only change (type permission-denied)',
  })
  @ApiNotFoundResponse({ description: 'No such role in this school' })
  @ApiConflictResponse({ description: 'The name is taken (errors[] path name)' })
  @ApiTooManyRequestsResponse({ description: 'More than 60 changes in an hour' })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Body() body: UpdateRoleRequestDto,
    @Req() req: Request,
  ): Promise<Role> {
    return this.roles.update(auth, id, body, meta(req));
  }

  @Post('roles/:id/reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('iam.manage')
  @ApiOperation({
    operationId: 'resetRole',
    summary: "Restore a built-in role's default permissions, description and two-step setting",
  })
  @ApiOkResponse({ type: RoleDto })
  @ApiBadRequestResponse({ description: 'Not a built-in role' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({
    description: 'Needs iam.manage or the reset changes a permission you lack',
  })
  @ApiNotFoundResponse({ description: 'No such role in this school' })
  @ApiTooManyRequestsResponse({ description: 'More than 60 changes in an hour' })
  reset(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Role> {
    return this.roles.reset(auth, id, meta(req));
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('iam.manage')
  @ApiOperation({ operationId: 'deleteRole', summary: 'Delete a custom role nobody holds' })
  @ApiNoContentResponse({ description: 'The role was deleted.' })
  @ApiBadRequestResponse({ description: 'A built-in role cannot be deleted' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs iam.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: 'No such role in this school' })
  @ApiConflictResponse({ description: 'Someone still holds the role (type role-in-use)' })
  @ApiTooManyRequestsResponse({ description: 'More than 60 changes in an hour' })
  async remove(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.roles.remove(auth, id, meta(req));
  }
}
