import { type OnboardingResponse, onboardingResponseSchema } from '@classloom/contracts';
import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';

import { withNullableProperties } from '../../core/http/nullable-openapi';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { RequirePermission } from '../iam/require-permission.decorator';
import { OnboardingService } from './onboarding.service';

class OnboardingResponseDto extends withNullableProperties(
  createZodDto(onboardingResponseSchema),
) {}

@ApiTags('school')
@ApiCookieAuth()
@Controller('school/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** Any member may ask; only `settings.manage` holders are ever shown the checklist. */
  @Get()
  @ApiOperation({
    operationId: 'getOnboarding',
    summary:
      'The setup checklist; visible is false without settings.manage, when all is done or dismissed',
  })
  @ApiOkResponse({ type: OnboardingResponseDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  get(@CurrentAuth() auth: RequestAuth): Promise<OnboardingResponse> {
    return this.onboarding.get(auth);
  }

  @Post('start')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'startOnboarding',
    summary: 'Record that the setup wizard was opened (only the first time is kept)',
  })
  @ApiNoContentResponse({ description: 'startedAt is set.' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  async start(@CurrentAuth() auth: RequestAuth): Promise<void> {
    await this.onboarding.start(auth);
  }

  @Post('dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'dismissOnboarding',
    summary: 'Hide the setup checklist for the whole school (only the first time is kept)',
  })
  @ApiNoContentResponse({ description: 'dismissedAt is set.' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  async dismiss(@CurrentAuth() auth: RequestAuth): Promise<void> {
    await this.onboarding.dismiss(auth);
  }
}
