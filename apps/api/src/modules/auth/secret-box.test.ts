import { randomBytes } from 'node:crypto';

import { decryptSecret, encryptSecret } from './secret-box';

describe('secret box', () => {
  const key = randomBytes(32);

  it('round-trips a value', () => {
    const box = encryptSecret(key, 'JBSWY3DPEHPK3PXP');
    expect(decryptSecret(key, box)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('lays the box out as iv, tag, ciphertext', () => {
    expect(encryptSecret(key, 'abc').length).toBe(12 + 16 + 3);
  });

  it('produces a different box each time for the same value', () => {
    expect(encryptSecret(key, 'same').equals(encryptSecret(key, 'same'))).toBe(false);
  });

  it('throws when the tag is tampered with', () => {
    const box = encryptSecret(key, 'secret');
    box[12] = box[12]! ^ 0xff;
    expect(() => decryptSecret(key, box)).toThrow();
  });

  it('throws when the ciphertext is tampered with', () => {
    const box = encryptSecret(key, 'secret');
    box[box.length - 1] = box[box.length - 1]! ^ 0xff;
    expect(() => decryptSecret(key, box)).toThrow();
  });

  it('throws under a different key or when truncated', () => {
    const box = encryptSecret(key, 'secret');
    expect(() => decryptSecret(randomBytes(32), box)).toThrow();
    expect(() => decryptSecret(key, box.subarray(0, 20))).toThrow();
  });
});
