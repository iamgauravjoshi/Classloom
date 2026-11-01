import type { LoginActivityPage, MyDevices, MySessions } from '@classloom/contracts';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { Prisma } from '../../generated/prisma/client';
import { AuthEventsService } from './auth-events.service';
import { sha256 } from './crypto';
import { deviceLabel } from './device-label';
import { KnownDeviceService } from './known-device.service';
import type { RequestAuth } from './request-auth';
import { SessionService } from './session.service';
import { isExpired } from './session-expiry';

export const MAX_SECURITY_CHANGES_PER_HOUR = 30;
export const ACTIVITY_PAGE_SIZE = 20;
const CHANGES_WINDOW_SECONDS = 3600;
const HISTORY_DAYS = 365;
const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SecurityMeta {
  ip?: string;
  userAgent?: string;
  /** The raw `cl_device` cookie value, when the browser sent a well-formed one. */
  deviceToken?: string;
}

/** Atomic: counts a change and returns {count, seconds left}. KEYS[1] counter. ARGV[1] window. */
const COUNT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, math.max(redis.call('TTL', KEYS[1]), 1)}
`;

interface ActivityRow {
  id: string;
  type: LoginActivityPage['events'][number]['type'];
  method: LoginActivityPage['events'][number]['method'];
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
  created_at_cursor: string;
  tenant_code: string | null;
  tenant_name: string | null;
}

const encodeCursor = (createdAt: string, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.createdAt === 'string' &&
      typeof parsed.id === 'string' &&
      UUID.test(parsed.id) &&
      !Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // falls through to the 400 below
  }
  throw new BadRequestException({ title: 'That page link is not valid.', message: 'Bad cursor.' });
}

const notFound = (what: string) =>
  new NotFoundException({ title: `No such ${what}.`, message: `No such ${what}.` });

/** The signed-in user's own sessions, devices and sign-in history (spec section 8). */
@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly knownDevices: KnownDeviceService,
    private readonly events: AuthEventsService,
  ) {}

  async listSessions(auth: RequestAuth): Promise<MySessions> {
    const now = new Date();
    const rows = await this.prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: now } },
      include: { tenant: { select: { code: true, name: true } } },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    });
    return {
      sessions: rows
        .filter((row) => !isExpired(row, now))
        .map((row) => ({
          id: row.id,
          current: row.id === auth.sessionId,
          school: { code: row.tenant.code.toUpperCase(), name: row.tenant.name },
          device: deviceLabel(row.userAgent),
          ip: row.ip,
          signedInAt: row.authenticatedAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
          remember: row.remember,
        })),
    };
  }

  async revokeSession(auth: RequestAuth, sessionId: string, meta: SecurityMeta): Promise<void> {
    await this.countChange(auth.userId);
    if (sessionId === auth.sessionId) {
      throw new BadRequestException({
        title: 'Use sign out to end this session.',
        message: 'This is the session you are using. Use sign out to end it.',
      });
    }
    const now = new Date();
    const target = UUID.test(sessionId)
      ? await this.prisma.session.findFirst({
          where: { id: sessionId, userId: auth.userId, revokedAt: null, expiresAt: { gt: now } },
        })
      : null;
    if (!target || isExpired(target, now)) throw notFound('session');
    await this.sessions.revoke(target.id, 'REVOKED_BY_USER');
    await this.events.record({
      type: 'SESSION_REVOKED',
      userId: auth.userId,
      tenantId: target.tenantId,
      sessionId: target.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async revokeOtherSessions(auth: RequestAuth, meta: SecurityMeta): Promise<void> {
    await this.countChange(auth.userId);
    const live = await this.prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null, id: { not: auth.sessionId } },
      select: { id: true, tenantId: true },
    });
    await this.sessions.revokeAllForUser(auth.userId, 'REVOKED_BY_USER', auth.sessionId);
    for (const row of live) {
      await this.events.record({
        type: 'SESSION_REVOKED',
        userId: auth.userId,
        tenantId: row.tenantId,
        sessionId: row.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
  }

  async listDevices(auth: RequestAuth, meta: SecurityMeta): Promise<MyDevices> {
    const rows = await this.prisma.knownDevice.findMany({
      where: { userId: auth.userId },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    });
    const currentHash = meta.deviceToken ? sha256(meta.deviceToken) : null;
    return {
      devices: rows.map((row) => ({
        id: row.id,
        label: row.label,
        current: currentHash !== null && currentHash.equals(Buffer.from(row.deviceHash)),
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        trustedUntil: row.trustedUntil?.toISOString() ?? null,
      })),
    };
  }

  async untrustDevice(auth: RequestAuth, deviceId: string, meta: SecurityMeta): Promise<void> {
    await this.countChange(auth.userId);
    if (!UUID.test(deviceId) || !(await this.knownDevices.untrust(auth.userId, deviceId))) {
      throw notFound('device');
    }
    await this.events.record({
      type: 'DEVICE_UNTRUSTED',
      userId: auth.userId,
      tenantId: auth.tenantId,
      sessionId: auth.sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Keyset pages on `(created_at, id)`. Raw SQL because `created_at` has microseconds and a JS
   * Date has milliseconds: the cursor carries the exact text so no row is skipped or repeated.
   */
  async listActivity(auth: RequestAuth, cursor?: string): Promise<LoginActivityPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    const since = new Date(Date.now() - HISTORY_DAYS * DAY);
    const rows = await this.prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
      SELECT e.id::text AS id, e.type::text AS type, e.method::text AS method,
             host(e.ip) AS ip, e.user_agent, e.created_at,
             to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
             t.code AS tenant_code, t.name AS tenant_name
        FROM auth_events e
        LEFT JOIN tenants t ON t.id = e.tenant_id
       WHERE e.user_id = ${auth.userId}::uuid
         AND e.created_at >= ${since}
         ${
           after
             ? Prisma.sql`AND (e.created_at, e.id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
             : Prisma.empty
         }
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ${ACTIVITY_PAGE_SIZE + 1}`);
    const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
    const last = page.at(-1);
    return {
      events: page.map((row) => ({
        id: row.id,
        type: row.type,
        method: row.method,
        school:
          row.tenant_code && row.tenant_name
            ? { code: row.tenant_code.toUpperCase(), name: row.tenant_name }
            : null,
        device: deviceLabel(row.user_agent),
        ip: row.ip,
        at: row.created_at.toISOString(),
      })),
      nextCursor:
        rows.length > ACTIVITY_PAGE_SIZE && last
          ? encodeCursor(last.created_at_cursor, last.id)
          : null,
    };
  }

  /** 30 changes per user per hour; a Redis outage must not block ending a session. */
  private async countChange(userId: string): Promise<void> {
    let count: number;
    let retryAfter: number;
    try {
      [count, retryAfter] = (await this.redis.client.eval(
        COUNT_SCRIPT,
        1,
        `auth:security-changes:${userId}`,
        CHANGES_WINDOW_SECONDS,
      )) as [number, number];
    } catch (error) {
      this.logger.warn(`Security change not counted, Redis unavailable: ${String(error)}`);
      return;
    }
    if (count > MAX_SECURITY_CHANGES_PER_HOUR) {
      throw new HttpException(
        {
          title: 'Too many changes.',
          message: 'Too many changes to your sessions and devices. Try again later.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
