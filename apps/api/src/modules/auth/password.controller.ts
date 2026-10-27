import { forgotPasswordRequestSchema, resetPasswordRequestSchema } from '@classloom/contracts';
import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';

import { PublicThrottlerGuard } from '../../core/http/public-throttler.guard';
import { PASSWORD_RESET_THROTTLER, skipAllBut } from '../../core/http/throttler-names';
import { PasswordResetService } from './password-reset.service';
import { Public } from './public.decorator';

class ForgotPasswordRequestDto extends createZodDto(forgotPasswordRequestSchema) {}
class ResetPasswordRequestDto extends createZodDto(resetPasswordRequestSchema) {}

@ApiTags('auth')
@Public()
@Controller('auth/password')
export class PasswordController {
  constructor(private readonly resets: PasswordResetService) {}

  @Post('forgot')
  @UseGuards(PublicThrottlerGuard)
  @SkipThrottle(skipAllBut(PASSWORD_RESET_THROTTLER))
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'requestPasswordReset',
    summary:
      'Email a password reset link (the answer is the same whether or not the account exists)',
  })
  @ApiAcceptedResponse({ description: 'Accepted; a link is emailed if an account matches.' })
  @ApiBadRequestResponse({ description: 'The identifier is not an email or a mobile number' })
  @ApiTooManyRequestsResponse({ description: 'Too many requests from this address' })
  @ApiServiceUnavailableResponse({ description: 'The queue is unreachable' })
  async requestPasswordReset(@Body() body: ForgotPasswordRequestDto): Promise<void> {
    await this.resets.request(body);
  }

  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'resetPassword',
    summary: 'Set a new password with a reset link token; signs everyone out and does not sign in',
  })
  @ApiNoContentResponse({ description: 'The password was changed.' })
  @ApiBadRequestResponse({
    description: 'The new password breaks the policy (errors[] with path newPassword and a code)',
  })
  @ApiGoneResponse({ description: 'The link is unknown, expired or already used' })
  async resetPassword(@Body() body: ResetPasswordRequestDto, @Req() req: Request): Promise<void> {
    await this.resets.reset(body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }
}
