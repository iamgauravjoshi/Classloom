import {
  listMembersQuerySchema,
  type Member,
  memberSchema,
  type MembersPage,
  membersPageSchema,
  setMemberRolesRequestSchema,
} from '@classloom/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
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

import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { MembersService } from './members.service';
import { RequirePermission } from './require-permission.decorator';

class MemberDto extends createZodDto(memberSchema) {}
class MembersPageDto extends createZodDto(membersPageSchema) {}
class ListMembersQueryDto extends createZodDto(listMembersQuerySchema) {}
class SetMemberRolesRequestDto extends createZodDto(setMemberRolesRequestSchema) {}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@ApiTags('iam')
@ApiCookieAuth()
@Controller('iam/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('iam.view')
  @ApiOperation({
    operationId: 'listMembers',
    summary: 'The school’s staff, 25 per page by name; pending invitations are listed separately',
  })
  @ApiOkResponse({ type: MembersPageDto })
  @ApiBadRequestResponse({ description: 'The cursor is not valid' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs iam.view (type permission-denied)' })
  list(
    @CurrentAuth() auth: RequestAuth,
    @Query() query: ListMembersQueryDto,
  ): Promise<MembersPage> {
    return this.members.list(auth, query);
  }

  @Put(':membershipId/roles')
  @RequirePermission('iam.manage')
  @ApiOperation({
    operationId: 'setMemberRoles',
    summary: 'Replace a member’s roles; no escalation, never the last owner; 60 changes per hour',
  })
  @ApiOkResponse({ type: MemberDto })
  @ApiBadRequestResponse({ description: 'No roles, or a role that does not exist' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({
    description:
      'Needs iam.manage, or a role involves a permission you lack or Owner without being an owner (type permission-denied)',
  })
  @ApiNotFoundResponse({ description: 'No such member in this school' })
  @ApiConflictResponse({ description: 'It would leave no owner (type last-owner)' })
  @ApiTooManyRequestsResponse({ description: 'More than 60 changes in an hour' })
  setRoles(
    @CurrentAuth() auth: RequestAuth,
    @Param('membershipId') membershipId: string,
    @Body() body: SetMemberRolesRequestDto,
    @Req() req: Request,
  ): Promise<Member> {
    return this.members.setRoles(auth, membershipId, body.roleIds, meta(req));
  }

  @Post(':membershipId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('iam.manage')
  @ApiOperation({
    operationId: 'deactivateMember',
    summary: 'Block a member and end their sessions at this school',
  })
  @ApiOkResponse({ type: MemberDto })
  @ApiBadRequestResponse({ description: 'You cannot deactivate yourself' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs iam.manage; only an owner may deactivate an owner' })
  @ApiNotFoundResponse({ description: 'No such member in this school' })
  @ApiConflictResponse({ description: 'The last owner cannot be deactivated (type last-owner)' })
  @ApiTooManyRequestsResponse({ description: 'More than 60 changes in an hour' })
  deactivate(
    @CurrentAuth() auth: RequestAuth,
    @Param('membershipId') membershipId: string,
    @Req() req: Request,
  ): Promise<Member> {
    return this.members.deactivate(auth, membershipId, meta(req));
  }

  @Post(':membershipId/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('iam.manage')
  @ApiOperation({
    operationId: 'reactivateMember',
    summary: 'Let a deactivated member sign in again',
  })
  @ApiOkResponse({ type: MemberDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs iam.manage; only an owner may reactivate an owner' })
  @ApiNotFoundResponse({ description: 'No such member in this school' })
  @ApiTooManyRequestsResponse({ description: 'More than 60 changes in an hour' })
  reactivate(
    @CurrentAuth() auth: RequestAuth,
    @Param('membershipId') membershipId: string,
    @Req() req: Request,
  ): Promise<Member> {
    return this.members.reactivate(auth, membershipId, meta(req));
  }

  @Post(':membershipId/reset-two-factor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('iam.manage')
  @ApiOperation({
    operationId: 'resetMemberTwoFactor',
    summary:
      'Turn off a member’s two-step sign-in, end their sessions at every school and email them; needs your recent sign-in',
  })
  @ApiNoContentResponse({ description: 'Two-step was turned off.' })
  @ApiBadRequestResponse({ description: 'Use My account › Security for your own two-step' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({
    description:
      'Needs iam.manage, a recent sign-in (type recent-sign-in-required), or an owner to reset an owner',
  })
  @ApiNotFoundResponse({ description: 'No such member in this school' })
  @ApiConflictResponse({ description: 'The person has no two-step sign-in (type two-factor-off)' })
  @ApiTooManyRequestsResponse({ description: 'More than 60 changes in an hour' })
  async resetTwoFactor(
    @CurrentAuth() auth: RequestAuth,
    @Param('membershipId') membershipId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.members.resetTwoFactor(auth, membershipId, meta(req));
  }
}
