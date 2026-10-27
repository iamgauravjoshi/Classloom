import { type AuthSession, passwordSignInRequestSchema } from '@classloom/contracts';
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
import { AuthSessionDto } from './dto';
import { PasswordSignInService } from './password-sign-in.service';
import { Public } from './public.decorator';
import { readSessionToken, setSessionCookie } from './session-cookie';

class PasswordSignInRequestDto extends createZodDto(passwordSignInRequestSchema) {}

@ApiTags('auth')
@Public()
@Controller('auth')
export class SignInController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly passwordSignIn: PasswordSignInService,
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
  @ApiUnauthorizedResponse({ description: 'Email/mobile or password is incorrect.' })
  @ApiTooManyRequestsResponse({
    description:
      'Paused after 5 wrong passwords (type sign-in-paused), or too many from this address',
  })
  async signInWithPassword(
    @Body() body: PasswordSignInRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const { token, session, remember } = await this.passwordSignIn.signIn(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      currentToken: readSessionToken(req, this.env),
    });
    setSessionCookie(res, this.env, token, remember);
    return session;
  }
}
