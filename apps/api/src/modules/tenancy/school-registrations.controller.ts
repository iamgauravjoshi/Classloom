import type { SchoolRegistrationAccepted, VerifyRegistrationResponse } from '@classloom/contracts';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiGoneResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { PublicThrottlerGuard } from '../../core/http/public-throttler.guard';
import { AVAILABILITY_THROTTLER } from '../../core/http/throttler-names';
import {
  ResendRegistrationRequestDto,
  SchoolRegistrationAcceptedDto,
  SchoolRegistrationRequestDto,
  VerifyRegistrationRequestDto,
  VerifyRegistrationResponseDto,
} from './dto';
import { SchoolRegistrationService } from './school-registration.service';

@ApiTags('school-registrations')
@Controller('school-registrations')
export class SchoolRegistrationsController {
  constructor(private readonly registrations: SchoolRegistrationService) {}

  @Post()
  @UseGuards(PublicThrottlerGuard)
  @SkipThrottle({ [AVAILABILITY_THROTTLER]: true })
  @HttpCode(202)
  @ApiOperation({
    operationId: 'createSchoolRegistration',
    summary: 'Register a school and email a verification link',
  })
  @ApiAcceptedResponse({ type: SchoolRegistrationAcceptedDto })
  @ApiConflictResponse({ description: 'The school code is already taken' })
  @ApiTooManyRequestsResponse({ description: 'Too many registrations from this address' })
  create(@Body() body: SchoolRegistrationRequestDto): Promise<SchoolRegistrationAccepted> {
    return this.registrations.register(body);
  }

  @Post('resend')
  @HttpCode(202)
  @ApiOperation({
    operationId: 'resendSchoolRegistration',
    summary: 'Email a new verification link; always 202',
  })
  @ApiAcceptedResponse({ description: 'Accepted whether or not a matching registration exists' })
  @ApiTooManyRequestsResponse({ description: 'More than 3 resends in an hour' })
  async resend(@Body() body: ResendRegistrationRequestDto): Promise<void> {
    await this.registrations.resend(body);
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'verifySchoolRegistration',
    summary: 'Verify a school registration',
  })
  @ApiOkResponse({ type: VerifyRegistrationResponseDto })
  @ApiGoneResponse({ description: 'The link is unknown, used or expired' })
  verify(@Body() body: VerifyRegistrationRequestDto): Promise<VerifyRegistrationResponse> {
    return this.registrations.verify(body.token);
  }
}
