import { randomInt } from 'node:crypto';

import { hmac } from './crypto';

/** Crockford base32: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_COUNT = 10;
const HALF_LENGTH = 5;

function randomHalf(): string {
  let out = '';
  // randomInt is unbiased (rejection sampling), unlike `byte % 32` style mapping.
  for (let i = 0; i < HALF_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** 10 unique codes shaped `XXXXX-XXXXX`. */
export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < CODE_COUNT) codes.add(`${randomHalf()}-${randomHalf()}`);
  return [...codes];
}

/**
 * Uppercase and drop hyphens and whitespace. Also maps the Crockford look-alikes a person might
 * mistype: O to 0, and I and L to 1 (the alphabet itself never contains I, L or O).
 */
export function normaliseRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** HMAC-SHA256 hex of a normalised code, keyed by AUTH_SECRET. */
export function hashRecoveryCode(secret: string, normalised: string): string {
  return hmac(secret, normalised);
}
