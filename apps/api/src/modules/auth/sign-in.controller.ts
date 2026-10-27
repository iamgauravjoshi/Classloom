import {
  type AuthSession,
  type CodeRequestAccepted,
  codeRequestAcceptedSchema,
  codeRequestSchema,
  codeVerifyRequestSchema,
  passwordSignInRequestSchema,
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
import { AuthSessionDto } from './dto';
import { EmailCodeService } from './email-code.service';
import { PasswordSignInService } from './password-sign-in.service';
import { Public } from './public.decorator';
import { readSessionToken, setSessionCookie } from './session-cookie';

class PasswordSignInRequestDto extends createZodDto(passwordSignInRequestSchema) {}
class CodeRequestDto extends createZodDto(codeRequestSchema) {}
class CodeRequestAcceptedDto extends createZodDto(codeRequestAcceptedSchema) {}
class CodeVerifyRequestDto extends createZodDto(codeVerifyRequestSchema) {}

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
  @ApiUnauthorizedResponse({ description: 'That code is incorrect or has expired.' })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts from this address' })
  async verifySignInCode(
    @Body() body: CodeVerifyRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const { token, session, remember } = await this.emailCodes.verify(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      currentToken: readSessionToken(req, this.env),
    });
    setSessionCookie(res, this.env, token, remember);
    return session;
  }
}
