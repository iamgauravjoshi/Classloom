import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/prisma/prisma.service';
import type { KnownDevice, Prisma } from '../../generated/prisma/client';
import { sha256 } from './crypto';
import { deviceLabel } from './device-label';

const DAY = 86_400_000;
const TRUST_DAYS = 30;

/** Prisma's Bytes type wants a Uint8Array over a plain ArrayBuffer, which a Buffer is not. */
const hashOf = (deviceToken: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(sha256(deviceToken));

@Injectable()
export class KnownDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  find(userId: string, deviceToken: string): Promise<KnownDevice | null> {
    return this.prisma.knownDevice.findUnique({
      where: { userId_deviceHash: { userId, deviceHash: hashOf(deviceToken) } },
    });
  }

  isTrusted(device: KnownDevice | null, now: Date): boolean {
    return device?.trustedUntil != null && device.trustedUntil.getTime() > now.getTime();
  }

  /**
   * Upserts the device for this sign-in. `trust` sets `trusted_until` to now + 30 days; without
   * it an existing trust is left as it is. `isNew` is true only when this call created the row.
   */
  async recordSignIn(
    userId: string,
    deviceToken: string,
    userAgent: string | null,
    opts: { trust: boolean },
    now = new Date(),
  ): Promise<{ device: KnownDevice; isNew: boolean }> {
    const deviceHash = hashOf(deviceToken);
    const trustedUntil = opts.trust ? new Date(now.getTime() + TRUST_DAYS * DAY) : undefined;
    // `updateMany` first so a concurrent first sign-in cannot be reported as new twice: the
    // loser of the create race falls back to the update.
    const updated = await this.prisma.knownDevice.updateMany({
      where: { userId, deviceHash },
      data: { lastSeenAt: now, ...(trustedUntil ? { trustedUntil } : {}) },
    });
    if (updated.count === 0) {
      try {
        const device = await this.prisma.knownDevice.create({
          data: {
            userId,
            deviceHash,
            label: deviceLabel(userAgent),
            firstSeenAt: now,
            lastSeenAt: now,
            trustedUntil: trustedUntil ?? null,
          },
        });
        return { device, isNew: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        await this.prisma.knownDevice.updateMany({
          where: { userId, deviceHash },
          data: { lastSeenAt: now, ...(trustedUntil ? { trustedUntil } : {}) },
        });
      }
    }
    const device = await this.prisma.knownDevice.findUniqueOrThrow({
      where: { userId_deviceHash: { userId, deviceHash } },
    });
    return { device, isNew: false };
  }

  /** False when the device does not exist or belongs to someone else. */
  async untrust(userId: string, deviceId: string): Promise<boolean> {
    const { count } = await this.prisma.knownDevice.updateMany({
      where: { id: deviceId, userId },
      data: { trustedUntil: null },
    });
    return count > 0;
  }

  /** Pass `tx` to run inside the caller's transaction. */
  async clearTrustForUser(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).knownDevice.updateMany({
      where: { userId, trustedUntil: { not: null } },
      data: { trustedUntil: null },
    });
  }
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
