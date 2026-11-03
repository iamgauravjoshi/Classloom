import {
  acceptInvitationRequestSchema,
  type AuthSession,
  type InvitationPreview,
  invitationPreviewSchema,
  type TwoFactorChallenge,
  twoFactorChallengeSchema,
} from '@classloom/contracts';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiGoneResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { PublicThrottlerGuard } from '../../core/http/public-throttler.guard';
import { SIGN_IN_THROTTLER, skipAllBut } from '../../core/http/throttler-names';
import { AuthSessionDto } from '../auth/dto';
import { deviceSignInMeta, respondToFirstFactor } from '../auth/first-factor-response';
import { Public } from '../auth/public.decorator';
import { InvitationsService } from './invitations.service';

class InvitationTokenDto extends createZodDto(acceptInvitationRequestSchema) {}
class InvitationPreviewDto extends createZodDto(invitationPreviewSchema) {}
class TwoFactorChallengeDto extends createZodDto(twoFactorChallengeSchema) {}

/** The token and what it reveals (school, masked email, a new session) are never cached. */
const NO_STORE = 'no-store';
const GONE = 'The invitation is unknown, expired, used or revoked, or the school is not active';

/** The join page's two calls. Public, and throttled per address like sign-in. */
@ApiTags('iam')
@Public()
@UseGuards(PublicThrottlerGuard)
@SkipThrottle(skipAllBut(SIGN_IN_THROTTLER))
@Controller('invitations')
export class InvitationAcceptController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly invitations: InvitationsService,
  ) {}

  @Get('preview')
  @Header('Cache-Control', NO_STORE)
  @ApiOperation({
    operationId: 'previewInvitation',
    summary: 'What an invitation link is for (school, masked email, name, roles); spends nothing',
  })
  @ApiOkResponse({ type: InvitationPreviewDto })
  @ApiBadRequestResponse({ description: 'No token' })
  @ApiGoneResponse({ description: GONE })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts from this address' })
  preview(@Query() query: InvitationTokenDto): Promise<InvitationPreview> {
    return this.invitations.preview(query.token);
  }

  @Post('accept')
  @Header('Cache-Control', NO_STORE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'acceptInvitation',
    summary: 'Join the school with an invitation link and sign in (single use)',
  })
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiAcceptedResponse({
    type: TwoFactorChallengeDto,
    description: 'Two-step sign-in is on: send the app code to /auth/two-factor/verify',
  })
  @ApiConflictResponse({
    description:
      'Already an active member (type already-member), or joined but not signed in (type invitation-joined, with schoolCode)',
  })
  @ApiGoneResponse({ description: GONE })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts from this address' })
  async accept(
    @Body() body: InvitationTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession | TwoFactorChallenge> {
    const meta = deviceSignInMeta(req, this.env);
    const outcome = await this.invitations.accept(body.token, meta);
    return respondToFirstFactor(outcome, meta.deviceToken, res, this.env);
  }
}
