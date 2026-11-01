import { describe, expect, it } from 'vitest';

import { hmac, identifierKey, randomToken, sha256 } from './crypto';

const SECRET = 'test-secret';

describe('identifierKey', () => {
  it('normalises email case and whitespace', () => {
    expect(identifierKey(SECRET, 't1', ' Anita@School.IN ')).toBe(
      identifierKey(SECRET, 't1', 'anita@school.in'),
    );
  });

  it('normalises mobile forms', () => {
    const a = identifierKey(SECRET, 't1', '9876543210');
    expect(identifierKey(SECRET, 't1', '+91 98765 43210')).toBe(a);
    expect(identifierKey(SECRET, 't1', '098765 43210')).toBe(a);
  });

  it('differs across tenants and secrets', () => {
    expect(identifierKey(SECRET, 't1', 'a@b.in')).not.toBe(identifierKey(SECRET, 't2', 'a@b.in'));
    expect(identifierKey(SECRET, 't1', 'a@b.in')).not.toBe(identifierKey('other', 't1', 'a@b.in'));
  });

  it('lowercases and trims unparseable input', () => {
    expect(identifierKey(SECRET, 't1', '  ROLL-No 7 ')).toBe(
      identifierKey(SECRET, 't1', 'roll-no 7'),
    );
  });

  it('handles very long input without throwing', () => {
    const key = identifierKey(SECRET, 't1', 'x'.repeat(1_000_000));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('randomToken', () => {
  it('is 43 base64url characters and unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const t = randomToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(1000);
  });
});

describe('sha256 and hmac', () => {
  it('sha256 returns a 32-byte Buffer', () => {
    const d = sha256('abc');
    expect(Buffer.isBuffer(d)).toBe(true);
    expect(d.toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hmac returns hex', () => {
    expect(hmac('k', 'v')).toMatch(/^[0-9a-f]{64}$/);
  });
});
