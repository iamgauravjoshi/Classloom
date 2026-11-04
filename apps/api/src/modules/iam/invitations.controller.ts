import {
  createInvitationRequestSchema,
  type Invitation,
  invitationSchema,
  type InvitationsResponse,
  invitationsResponseSchema,
} from '@classloom/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
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
import { InvitationsService } from './invitations.service';
import { RequirePermission } from './require-permission.decorator';

class InvitationDto extends withNullableProperties(createZodDto(invitationSchema)) {}
class InvitationsResponseDto extends createZodDto(invitationsResponseSchema) {}
class CreateInvitationRequestDto extends createZodDto(createInvitationRequestSchema) {}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@ApiTags('iam')
@ApiCookieAuth()
@Controller('iam/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequirePermission('iam.view')
  @ApiOperation({
    operationId: 'listInvitations',
    summary: 'The school’s open invitations (not accepted, revoked or expired), newest first',
  })
  @ApiOkResponse({ type: InvitationsResponseDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs iam.view (type permission-denied)' })
  list(@CurrentAuth() auth: RequestAuth): Promise<InvitationsResponse> {
    return this.invitations.list(auth);
  }

  @Post()
  @RequirePermission('iam.manage')
  @ApiOperation({
    operationId: 'createInvitation',
    summary:
      'Invite a person by email with roles you may grant; the link works for 7 days; 50 per day per school',
  })
  @ApiCreatedResponse({ type: InvitationDto })
  @ApiBadRequestResponse({ description: 'Invalid fields, or a role that does not exist' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({
    description:
      'Needs iam.manage, or a role involves a permission you lack or Owner without being an owner (type permission-denied)',
  })
  @ApiConflictResponse({
    description:
      'Already an active member (type already-member) or already invited (type already-invited)',
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 60 changes in an hour, or 50 invitations in a day at this school',
  })
  create(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CreateInvitationRequestDto,
    @Req() req: Request,
  ): Promise<Invitation> {
    return this.invitations.create(auth, body, meta(req));
  }

  @Post(':invitationId/resend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('iam.manage')
  @ApiOperation({
    operationId: 'resendInvitation',
    summary: 'Email a new link with a new 7-day expiry; the old link stops working; 3 per day',
  })
  @ApiOkResponse({ type: InvitationDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({
    description: 'Needs iam.manage, and every role in the invitation must be yours to grant',
  })
  @ApiNotFoundResponse({ description: 'No such invitation in this school' })
  @ApiConflictResponse({
    description: 'The person is now a member (type already-member) or has another invitation',
  })
  @ApiGoneResponse({ description: 'The invitation was accepted or revoked, or has no roles left' })
  @ApiTooManyRequestsResponse({
    description: 'More than 60 changes in an hour, or 3 re-sends of this invitation in a day',
  })
  resend(
    @CurrentAuth() auth: RequestAuth,
    @Param('invitationId') invitationId: string,
  ): Promise<Invitation> {
    return this.invitations.resend(auth, invitationId);
  }

  @Post(':invitationId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('iam.manage')
  @ApiOperation({ operationId: 'revokeInvitation', summary: 'Withdraw an invitation' })
  @ApiNoContentResponse({ description: 'The invitation was withdrawn (or already was).' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs iam.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: 'No such invitation in this school' })
  @ApiGoneResponse({ description: 'The invitation was already accepted' })
  @ApiTooManyRequestsResponse({ description: 'More than 60 changes in an hour' })
  async revoke(
    @CurrentAuth() auth: RequestAuth,
    @Param('invitationId') invitationId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.invitations.revoke(auth, invitationId, meta(req));
  }
}
