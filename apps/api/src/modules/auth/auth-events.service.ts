import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthEventType, AuthMethod } from '../../generated/prisma/client';

export const MAX_USER_AGENT_LENGTH = 512;

export interface AuthEventInput {
  type: AuthEventType;
  method?: AuthMethod;
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
}

/** The sign-in audit log. The typed identifier is never stored. */
@Injectable()
export class AuthEventsService {
  private readonly logger = new Logger(AuthEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws: a failed audit write must not fail the sign-in that triggered it. */
  async record(event: AuthEventInput): Promise<void> {
    try {
      await this.prisma.authEvent.create({
        data: {
          type: event.type,
          method: event.method ?? null,
          userId: event.userId ?? null,
          tenantId: event.tenantId ?? null,
          sessionId: event.sessionId ?? null,
          ip: event.ip ?? null,
          userAgent: event.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Could not record auth event ${event.type}: ${String(error)}`);
    }
  }
}
