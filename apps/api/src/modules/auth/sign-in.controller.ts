import {
  type AuthSession,
  type CodeRequestAccepted,
  codeRequestAcceptedSchema,
  codeRequestSchema,
  codeVerifyRequestSchema,
  passwordSignInRequestSchema,
  type TwoFactorChallenge,
  twoFactorChallengeSchema,
} from '@classloom/contracts';
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
  ApiAcceptedResponse,
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
import {
  CODE_REQUEST_THROTTLER,
  SIGN_IN_THROTTLER,
  skipAllBut,
} from '../../core/http/throttler-names';
import { deviceTokenOf, setDeviceCookie } from './device-cookie';
import { AuthSessionDto } from './dto';
import { EmailCodeService } from './email-code.service';
import { PasswordSignInService } from './password-sign-in.service';
import { Public } from './public.decorator';
import { readSessionToken, setSessionCookie } from './session-cookie';
import type { DeviceSignInMeta, FirstFactorOutcome } from './two-factor-sign-in.service';

class PasswordSignInRequestDto extends createZodDto(passwordSignInRequestSchema) {}
class CodeRequestDto extends createZodDto(codeRequestSchema) {}
class CodeRequestAcceptedDto extends createZodDto(codeRequestAcceptedSchema) {}
class CodeVerifyRequestDto extends createZodDto(codeVerifyRequestSchema) {}
class TwoFactorChallengeDto extends createZodDto(twoFactorChallengeSchema) {}

@ApiTags('auth')
@Public()
@Controller('auth')
export class SignInController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly passwordSignIn: PasswordSignInService,
    private readonly emailCodes: EmailCodeService,
  ) {}

  @Post('sign-in/password')
  @UseGuards(PublicThrottlerGuard)
  @SkipThrottle(skipAllBut(SIGN_IN_THROTTLER))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'signInWithPassword',
    summary: 'Sign in to a school with an email or mobile and a password',
  })
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiAcceptedResponse({
    type: TwoFactorChallengeDto,
    description: 'Two-step sign-in is on: send the app code to /auth/two-factor/verify',
  })
  @ApiUnauthorizedResponse({ description: 'Email/mobile or password is incorrect.' })
  @ApiTooManyRequestsResponse({
    description:
      'Paused after 5 wrong passwords (type sign-in-paused), or too many from this address',
  })
  async signInWithPassword(
    @Body() body: PasswordSignInRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession | TwoFactorChallenge> {
    const deviceToken = deviceTokenOf(req, this.env);
    const outcome = await this.passwordSignIn.signIn(body, this.meta(req, deviceToken));
    return this.respond(outcome, deviceToken, res);
  }

  @Post('otp/request')
  @UseGuards(PublicThrottlerGuard)
  @SkipThrottle(skipAllBut(CODE_REQUEST_THROTTLER))
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'requestSignInCode',
    summary:
      'Email a 6-digit sign-in code (the answer is the same whether or not the account exists)',
  })
  @ApiAcceptedResponse({ type: CodeRequestAcceptedDto })
  @ApiTooManyRequestsResponse({ description: 'Too many requests from this address' })
  @ApiServiceUnavailableResponse({ description: 'The queue is unreachable' })
  requestSignInCode(@Body() body: CodeRequestDto): Promise<CodeRequestAccepted> {
    return this.emailCodes.request(body);
  }

  @Post('otp/verify')
  @UseGuards(PublicThrottlerGuard)
  @SkipThrottle(skipAllBut(SIGN_IN_THROTTLER))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'verifySignInCode',
    summary: 'Sign in to a school with an emailed code',
  })
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiAcceptedResponse({
    type: TwoFactorChallengeDto,
    description: 'Two-step sign-in is on: send the app code to /auth/two-factor/verify',
  })
  @ApiUnauthorizedResponse({ description: 'That code is incorrect or has expired.' })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts from this address' })
  async verifySignInCode(
    @Body() body: CodeVerifyRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession | TwoFactorChallenge> {
    const deviceToken = deviceTokenOf(req, this.env);
    const outcome = await this.emailCodes.verify(body, this.meta(req, deviceToken));
    return this.respond(outcome, deviceToken, res);
  }

  private meta(req: Request, deviceToken: string): DeviceSignInMeta {
    return {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      currentToken: readSessionToken(req, this.env),
      deviceToken,
    };
  }

  /**
   * The device cookie is set on every first-factor success; the session cookie only when a
   * session was made. A pending two-step sign-in answers 202 with the challenge.
   */
  private respond(
    outcome: FirstFactorOutcome,
    deviceToken: string,
    res: Response,
  ): AuthSession | TwoFactorChallenge {
    if (outcome.kind === 'challenge') {
      setDeviceCookie(res, this.env, deviceToken);
      res.status(HttpStatus.ACCEPTED);
      return outcome.body;
    }
    // Session cookie first, as before this cookie existed.
    setSessionCookie(res, this.env, outcome.token, outcome.remember);
    setDeviceCookie(res, this.env, deviceToken);
    return outcome.session;
  }
}
