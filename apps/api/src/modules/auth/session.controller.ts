import type { AuthSession } from '@classloom/contracts';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env.schema';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthEventsService } from './auth-events.service';
import { CurrentAuth } from './current-auth.decorator';
import { AuthSessionDto } from './dto';
import { Public } from './public.decorator';
import type { RequestAuth } from './request-auth';
import { SessionService } from './session.service';
import { clearSessionCookie, readSessionToken } from './session-cookie';

@ApiTags('auth')
@Controller('auth')
export class SessionController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('session')
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'getAuthSession', summary: 'The signed-in user, school and role' })
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  async getSession(@Req() req: Request, @CurrentAuth() auth: RequestAuth): Promise<AuthSession> {
    const token = readSessionToken(req, this.env);
    const resolved = token ? await this.sessions.resolve(token) : null;
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!resolved || !user) throw new UnauthorizedException('Sign in to continue');
    return this.sessions.toAuthSession(resolved, { role: auth.role }, user);
  }

  @Post('sign-out')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'signOut', summary: 'End the current session' })
  @ApiNoContentResponse({ description: 'Signed out, also when there was no session' })
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentAuth() auth: RequestAuth | undefined,
  ): Promise<void> {
    clearSessionCookie(res, this.env);
    if (!auth) return;
    await this.sessions.revoke(auth.sessionId, 'SIGNED_OUT');
    await this.events.record({
      type: 'SIGNED_OUT',
      userId: auth.userId,
      tenantId: auth.tenantId,
      sessionId: auth.sessionId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
