import {
  type RecoveryCodes,
  recoveryCodesSchema,
  twoFactorCodeRequestSchema,
  twoFactorDisableRequestSchema,
  type TwoFactorSetup,
  twoFactorSetupSchema,
  type TwoFactorStatus,
  twoFactorStatusSchema,
} from '@classloom/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';

import { withNullableProperties } from '../../core/http/nullable-openapi';
import { CurrentAuth } from './current-auth.decorator';
import type { RequestAuth } from './request-auth';
import { type SettingsMeta, TwoFactorService } from './two-factor.service';

class TwoFactorStatusDto extends withNullableProperties(createZodDto(twoFactorStatusSchema)) {}
class TwoFactorSetupDto extends createZodDto(twoFactorSetupSchema) {}
class TwoFactorCodeRequestDto extends createZodDto(twoFactorCodeRequestSchema) {}
class TwoFactorDisableRequestDto extends createZodDto(twoFactorDisableRequestSchema) {}
class RecoveryCodesDto extends createZodDto(recoveryCodesSchema) {}

const RECENT_SIGN_IN = 'No sign-in in the last 10 minutes (type recent-sign-in-required)';
const WRONG_CODE = 'The code is wrong (errors[] path code or recoveryCode)';
const PAUSED = 'Too many wrong codes in 15 minutes (type two-factor-paused)';

const metaOf = (req: Request): SettingsMeta => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

/** The signed-in user's security settings. Every route needs a session (no `@Public()`). */
@ApiTags('me')
@ApiCookieAuth()
@Controller('me')
export class SecurityController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get('two-factor')
  @ApiOperation({
    operationId: 'getTwoFactorStatus',
    summary: 'Whether two-step sign-in is on, since when, and the recovery codes left',
  })
  @ApiOkResponse({ type: TwoFactorStatusDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  getTwoFactorStatus(@CurrentAuth() auth: RequestAuth): Promise<TwoFactorStatus> {
    return this.twoFactor.status(auth);
  }

  @Post('two-factor/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'startTwoFactorSetup',
    summary: 'Start turning two-step sign-in on; the secret is kept for 10 minutes',
  })
  @ApiOkResponse({ type: TwoFactorSetupDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: RECENT_SIGN_IN })
  @ApiConflictResponse({ description: 'Two-step sign-in is already on' })
  startTwoFactorSetup(@CurrentAuth() auth: RequestAuth): Promise<TwoFactorSetup> {
    return this.twoFactor.startSetup(auth);
  }

  @Post('two-factor/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'enableTwoFactor',
    summary:
      'Finish turning two-step sign-in on with the first code; returns the recovery codes once',
  })
  @ApiOkResponse({ type: RecoveryCodesDto })
  @ApiBadRequestResponse({ description: WRONG_CODE })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: RECENT_SIGN_IN })
  @ApiConflictResponse({ description: 'Two-step sign-in is already on' })
  @ApiGoneResponse({ description: 'The setup expired; start again' })
  @ApiTooManyRequestsResponse({ description: PAUSED })
  enableTwoFactor(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: TwoFactorCodeRequestDto,
    @Req() req: Request,
  ): Promise<RecoveryCodes> {
    return this.twoFactor.enable(auth, body, metaOf(req));
  }

  @Post('two-factor/recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'regenerateRecoveryCodes',
    summary: 'Replace the recovery codes; needs a current app code',
  })
  @ApiOkResponse({ type: RecoveryCodesDto })
  @ApiBadRequestResponse({ description: WRONG_CODE })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: RECENT_SIGN_IN })
  @ApiConflictResponse({ description: 'Two-step sign-in is not on' })
  @ApiTooManyRequestsResponse({ description: PAUSED })
  regenerateRecoveryCodes(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: TwoFactorCodeRequestDto,
    @Req() req: Request,
  ): Promise<RecoveryCodes> {
    return this.twoFactor.regenerateRecoveryCodes(auth, body, metaOf(req));
  }

  @Post('two-factor/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'disableTwoFactor',
    summary: 'Turn two-step sign-in off with an app code or a recovery code',
  })
  @ApiNoContentResponse({ description: 'Two-step sign-in is off.' })
  @ApiBadRequestResponse({ description: WRONG_CODE })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: RECENT_SIGN_IN })
  @ApiConflictResponse({ description: 'Two-step sign-in is not on' })
  @ApiTooManyRequestsResponse({ description: PAUSED })
  async disableTwoFactor(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: TwoFactorDisableRequestDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.twoFactor.disable(auth, body, metaOf(req));
  }
}
