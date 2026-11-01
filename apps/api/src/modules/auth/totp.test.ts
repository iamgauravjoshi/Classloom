import { generateSync } from 'otplib';
import { describe, expect, it } from 'vitest';

import { generateTotpSecret, matchTotpStep, otpauthUrl } from './totp';

// "12345678901234567890" in base32 (RFC 6238 SHA-1 test secret).
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const NOW = new Date(1_700_000_010_000); // epoch 1_700_000_010 s -> step 56666667
const STEP = 56_666_667n;

function codeAtStep(step: bigint): string {
  return generateSync({ secret: SECRET, epoch: Number(step) * 30 });
}

describe('generateTotpSecret', () => {
  it('is base32 of 20 random bytes', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(s);
  });
});

describe('otpauthUrl', () => {
  it('encodes the email and carries every parameter', () => {
    const url = otpauthUrl('a+b@x.in', SECRET);
    expect(url).toBe(
      `otpauth://totp/Classloom:${encodeURIComponent('a+b@x.in')}?secret=${SECRET}&issuer=Classloom&digits=6&period=30&algorithm=SHA1`,
    );
    expect(url).toContain('a%2Bb%40x.in');
  });
});

describe('matchTotpStep', () => {
  it('matches the RFC 6238 SHA-1 vector (T=59s, 6 digits)', () => {
    expect(matchTotpStep(RFC_SECRET, '287082', new Date(59_000), null)).toBe(1n);
  });

  it('accepts the current step', () => {
    expect(matchTotpStep(SECRET, codeAtStep(STEP), NOW, null)).toBe(STEP);
  });

  it('accepts one step either side', () => {
    expect(matchTotpStep(SECRET, codeAtStep(STEP - 1n), NOW, null)).toBe(STEP - 1n);
    expect(matchTotpStep(SECRET, codeAtStep(STEP + 1n), NOW, null)).toBe(STEP + 1n);
  });

  it('rejects two steps either side', () => {
    expect(matchTotpStep(SECRET, codeAtStep(STEP - 2n), NOW, null)).toBeNull();
    expect(matchTotpStep(SECRET, codeAtStep(STEP + 2n), NOW, null)).toBeNull();
  });

  it('rejects a step at or before lastStep (replay)', () => {
    expect(matchTotpStep(SECRET, codeAtStep(STEP), NOW, STEP)).toBeNull();
    expect(matchTotpStep(SECRET, codeAtStep(STEP - 1n), NOW, STEP)).toBeNull();
    expect(matchTotpStep(SECRET, codeAtStep(STEP + 1n), NOW, STEP)).toBe(STEP + 1n);
  });

  it('ignores spaces and returns null for blank or malformed codes', () => {
    const c = codeAtStep(STEP);
    expect(matchTotpStep(SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, NOW, null)).toBe(STEP);
    for (const bad of ['', '   ', '12345', '1234567', 'abcdef']) {
      expect(matchTotpStep(SECRET, bad, NOW, null)).toBeNull();
    }
  });
});
