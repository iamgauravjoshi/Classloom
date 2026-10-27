import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  // argon2@0.45 encodes parameters as m,p,t (brief assumed m,t,p); same parameters.
  it('hashes with the OWASP argon2id baseline', async () => {
    const h = await svc.hash('violet tractor mango');
    expect(h.startsWith('$argon2id$v=19$m=19456,p=1,t=2$')).toBe(true);
    expect(svc.needsRehash(h)).toBe(false);
  });

  it('verifies correct and incorrect passwords', async () => {
    const h = await svc.hash('violet tractor mango');
    expect(await svc.verify(h, 'violet tractor mango')).toBe(true);
    expect(await svc.verify(h, 'wrong')).toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await svc.verify('not-a-hash', 'x')).toBe(false);
  });

  it('verifyDummy resolves false', async () => {
    expect(await svc.verifyDummy('anything')).toBe(false);
  });

  it('needsRehash is true for weaker parameters', async () => {
    const weak = await argon2.hash('x', {
      type: argon2.argon2id,
      timeCost: 1,
      memoryCost: 19456,
      parallelism: 1,
    });
    expect(svc.needsRehash(weak)).toBe(true);
  });
});
