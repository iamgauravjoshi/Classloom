import {
  type LoginActivityPage,
  loginActivityPageSchema,
  type MyDevices,
  myDevicesSchema,
  type MySessions,
  mySessionsSchema,
  type RecoveryCodes,
  recoveryCodesSchema,
  twoFactorCodeRequestSchema,
  twoFactorDisableRequestSchema,
  type TwoFactorSetup,
  twoFactorSetupSchema,
  type TwoFactorStatus,
  twoFactorStatusSchema,
} from '@classloom/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { withNullableProperties } from '../../core/http/nullable-openapi';
import { CurrentAuth } from './current-auth.decorator';
import { readDeviceToken } from './device-cookie';
import type { RequestAuth } from './request-auth';
import { type SecurityMeta, SecurityService } from './security.service';
import { type SettingsMeta, TwoFactorService } from './two-factor.service';
import { AllowDuringTwoFactorSetup } from './two-factor-setup.guard';

class TwoFactorStatusDto extends withNullableProperties(createZodDto(twoFactorStatusSchema)) {}
class TwoFactorSetupDto extends createZodDto(twoFactorSetupSchema) {}
class TwoFactorCodeRequestDto extends createZodDto(twoFactorCodeRequestSchema) {}
class TwoFactorDisableRequestDto extends createZodDto(twoFactorDisableRequestSchema) {}
class RecoveryCodesDto extends createZodDto(recoveryCodesSchema) {}
class MySessionsDto extends createZodDto(mySessionsSchema) {}
class MyDevicesDto extends createZodDto(myDevicesSchema) {}
class LoginActivityPageDto extends withNullableProperties(createZodDto(loginActivityPageSchema)) {}

const RECENT_SIGN_IN = 'No sign-in in the last 10 minutes (type recent-sign-in-required)';
const WRONG_CODE = 'The code is wrong (errors[] path code or recoveryCode)';
const PAUSED = 'Too many wrong codes in 15 minutes (type two-factor-paused)';

const metaOf = (req: Request): SettingsMeta => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

const LIMIT = 'More than 30 changes in an hour';

/** The signed-in user's security settings. Every route needs a session (no `@Public()`). */
@ApiTags('me')
@ApiCookieAuth()
@Controller('me')
export class SecurityController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly twoFactor: TwoFactorService,
    private readonly security: SecurityService,
  ) {}

  private securityMeta(req: Request): SecurityMeta {
    return { ...metaOf(req), deviceToken: readDeviceToken(req, this.env) };
  }

  @Get('two-factor')
  @AllowDuringTwoFactorSetup()
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
  @AllowDuringTwoFactorSetup()
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
  @AllowDuringTwoFactorSetup()
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

  @Get('sessions')
  @ApiOperation({
    operationId: 'listMySessions',
    summary: 'The live sessions of the signed-in user, across all their schools',
  })
  @ApiOkResponse({ type: MySessionsDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  listMySessions(@CurrentAuth() auth: RequestAuth): Promise<MySessions> {
    return this.security.listSessions(auth);
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'revokeMyOtherSessions',
    summary: 'End every live session except the one in use',
  })
  @ApiNoContentResponse({ description: 'The other sessions are ended.' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiTooManyRequestsResponse({ description: LIMIT })
  async revokeMyOtherSessions(
    @CurrentAuth() auth: RequestAuth,
    @Req() req: Request,
  ): Promise<void> {
    await this.security.revokeOtherSessions(auth, this.securityMeta(req));
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'revokeMySession', summary: "End one of the user's other sessions" })
  @ApiParam({ name: 'id', description: 'The session id' })
  @ApiNoContentResponse({ description: 'The session is ended.' })
  @ApiBadRequestResponse({ description: 'This is the current session; use sign out' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiNotFoundResponse({ description: 'Not a live session of this user' })
  @ApiTooManyRequestsResponse({ description: LIMIT })
  async revokeMySession(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.security.revokeSession(auth, id, this.securityMeta(req));
  }

  @Get('devices')
  @ApiOperation({
    operationId: 'listMyDevices',
    summary: 'The browsers that have signed in to this account',
  })
  @ApiOkResponse({ type: MyDevicesDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  listMyDevices(@CurrentAuth() auth: RequestAuth, @Req() req: Request): Promise<MyDevices> {
    return this.security.listDevices(auth, this.securityMeta(req));
  }

  @Post('devices/:id/untrust')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'untrustMyDevice',
    summary: 'Stop skipping the app code on this device',
  })
  @ApiParam({ name: 'id', description: 'The device id' })
  @ApiNoContentResponse({ description: 'The device is no longer trusted.' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiNotFoundResponse({ description: 'Not a device of this user' })
  @ApiTooManyRequestsResponse({ description: LIMIT })
  async untrustMyDevice(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.security.untrustDevice(auth, id, this.securityMeta(req));
  }

  @Get('login-activity')
  @ApiOperation({
    operationId: 'listMyLoginActivity',
    summary: 'Sign-in history for the past 365 days, newest first, 20 per page',
  })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor of the previous page' })
  @ApiOkResponse({ type: LoginActivityPageDto })
  @ApiBadRequestResponse({ description: 'The cursor is not valid' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  listMyLoginActivity(
    @CurrentAuth() auth: RequestAuth,
    @Query('cursor') cursor?: string,
  ): Promise<LoginActivityPage> {
    return this.security.listActivity(auth, cursor);
  }
}
