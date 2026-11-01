import {
  type Me,
  meSchema,
  setPasswordRequestSchema,
  updateMeRequestSchema,
} from '@classloom/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Put, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
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
import { AccountService } from './account.service';
import { CurrentAuth } from './current-auth.decorator';
import type { RequestAuth } from './request-auth';

class MeDto extends withNullableProperties(createZodDto(meSchema)) {}
class UpdateMeRequestDto extends withNullableProperties(createZodDto(updateMeRequestSchema)) {}
class SetPasswordRequestDto extends createZodDto(setPasswordRequestSchema) {}

@ApiTags('me')
@ApiCookieAuth()
@Controller('me')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  @ApiOperation({ operationId: 'getMe', summary: 'The signed-in user' })
  @ApiOkResponse({ type: MeDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  getMe(@CurrentAuth() auth: RequestAuth): Promise<Me> {
    return this.account.getMe(auth);
  }

  @Patch()
  @ApiOperation({
    operationId: 'updateMe',
    summary: 'Change your name or mobile number (null clears the mobile); 20 changes per hour',
  })
  @ApiOkResponse({ type: MeDto })
  @ApiBadRequestResponse({ description: 'The name or mobile is not valid' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiConflictResponse({
    description: 'The mobile belongs to another account (errors[] path mobile)',
  })
  @ApiTooManyRequestsResponse({ description: 'More than 20 changes in an hour' })
  updateMe(@CurrentAuth() auth: RequestAuth, @Body() body: UpdateMeRequestDto): Promise<Me> {
    return this.account.updateMe(auth, body);
  }

  @Put('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'setPassword',
    summary: 'Set a first password or change it; signs out your other sessions',
  })
  @ApiNoContentResponse({ description: 'The password was saved.' })
  @ApiBadRequestResponse({
    description:
      'The current password is missing or wrong (path currentPassword), or the new one breaks the policy (path newPassword)',
  })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({
    description:
      'First set without a sign-in in the last 10 minutes (type recent-sign-in-required)',
  })
  @ApiTooManyRequestsResponse({ description: 'Password attempts are paused (type sign-in-paused)' })
  async setPassword(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: SetPasswordRequestDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.account.setPassword(auth, body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
