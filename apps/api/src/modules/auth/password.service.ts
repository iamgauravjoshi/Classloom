import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** OWASP baseline for argon2id: 19 MiB, 2 iterations, parallelism 1. */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  /** Computed once at construction; used to equalise timing when the account does not exist. */
  private readonly dummyHash: Promise<string> = argon2.hash('classloom-dummy-password', OPTIONS);

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  async verifyDummy(password: string): Promise<false> {
    await this.verify(await this.dummyHash, password);
    return false;
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }
}
