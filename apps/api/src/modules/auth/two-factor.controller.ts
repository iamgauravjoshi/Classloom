import { type AuthSession, twoFactorVerifyRequestSchema } from '@classloom/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { PublicThrottlerGuard } from '../../core/http/public-throttler.guard';
import { SIGN_IN_THROTTLER, skipAllBut } from '../../core/http/throttler-names';
import { deviceTokenOf, setDeviceCookie } from './device-cookie';
import { AuthSessionDto } from './dto';
import { Public } from './public.decorator';
import { readSessionToken, setSessionCookie } from './session-cookie';
import { TwoFactorSignInService } from './two-factor-sign-in.service';

class TwoFactorVerifyRequestDto extends createZodDto(twoFactorVerifyRequestSchema) {}

@ApiTags('auth')
@Public()
@Controller('auth/two-factor')
export class TwoFactorController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly twoFactorSignIn: TwoFactorSignInService,
  ) {}

  @Post('verify')
  @UseGuards(PublicThrottlerGuard)
  @SkipThrottle(skipAllBut(SIGN_IN_THROTTLER))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'verifyTwoFactor',
    summary: 'Finish a two-step sign-in with an authenticator app code or a recovery code',
  })
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiUnauthorizedResponse({
    description:
      "The sign-in has expired (type two-factor-expired), or the code didn't work (type two-factor-invalid, with attemptsLeft)",
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many wrong codes (type two-factor-paused), or too many from this address',
  })
  @ApiServiceUnavailableResponse({ description: 'The challenge store is unreachable' })
  async verifyTwoFactor(
    @Body() body: TwoFactorVerifyRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const deviceToken = deviceTokenOf(req, this.env);
    const { token, session, remember } = await this.twoFactorSignIn.verifyChallenge(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      currentToken: readSessionToken(req, this.env),
      deviceToken,
    });
    setSessionCookie(res, this.env, token, remember);
    setDeviceCookie(res, this.env, deviceToken);
    return session;
  }
}
