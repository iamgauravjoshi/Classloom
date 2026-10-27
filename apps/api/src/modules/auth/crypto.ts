import { createHash, createHmac, randomBytes } from 'node:crypto';

import { parseIdentifier } from '@classloom/utils';

/** Identifiers longer than this are truncated before hashing; real emails are at most 254 characters. */
const MAX_IDENTIFIER_LENGTH = 512;

/** 32 random bytes as base64url (43 characters). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** HMAC-SHA256, hex encoded. Compare results elsewhere with `timingSafeEqual`. */
export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * Stable per-tenant key for an identifier (email or mobile), used for throttling and lookups
 * without storing the raw value. Unparseable input is lowercased and trimmed. Oversized input is
 * truncated to 512 characters first, so a huge string cannot cost more than a bounded amount of work.
 */
export function identifierKey(secret: string, tenantId: string, identifier: string): string {
  const bounded = identifier.slice(0, MAX_IDENTIFIER_LENGTH);
  const parsed = parseIdentifier(bounded);
  const normalised = parsed.kind === 'invalid' ? bounded.trim().toLowerCase() : parsed.value;
  return hmac(secret, `${tenantId}:${normalised}`);
}
