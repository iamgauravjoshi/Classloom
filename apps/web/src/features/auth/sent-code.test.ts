import { describe, expect, it } from 'vitest';

import { clearSentCode, loadSentCode, reusableCode, saveSentCode, sentCode } from './sent-code';

const NOW = Date.UTC(2026, 9, 31, 10, 0, 0);

describe('sentCode', () => {
  it('expires in 10 minutes and allows a resend after 60 seconds', () => {
    expect(sentCode('GISD', 'a@example.com', 'a***@example.com', NOW)).toEqual({
      schoolCode: 'GISD',
      email: 'a@example.com',
      maskedEmail: 'a***@example.com',
      expiresAt: NOW + 600_000,
      resendAt: NOW + 60_000,
    });
  });
});

describe('reusableCode', () => {
  const last = sentCode('GISD', 'a@example.com', 'a***@example.com', NOW);

  it('reuses the last code for the same school and email within 60 seconds', () => {
    expect(reusableCode(last, 'GISD', 'a@example.com', NOW + 30_000)).toBe(last);
  });

  it('asks for a new code once a resend is allowed', () => {
    expect(reusableCode(last, 'GISD', 'a@example.com', NOW + 60_000)).toBeNull();
  });

  it('asks for a new code for another email or school, or with none sent', () => {
    expect(reusableCode(last, 'GISD', 'b@example.com', NOW + 1_000)).toBeNull();
    expect(reusableCode(last, 'OTHER', 'a@example.com', NOW + 1_000)).toBeNull();
    expect(reusableCode(null, 'GISD', 'a@example.com', NOW + 1_000)).toBeNull();
  });
});

describe('saved code', () => {
  const store = (): Pick<Storage, 'getItem' | 'setItem'> => {
    const items = new Map<string, string>();
    return {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
    };
  };
  const sent = sentCode('GISD', 'a@example.com', 'a***@example.com', NOW);

  it('gives back the code that was saved', () => {
    const storage = store();
    saveSentCode(sent, storage);
    expect(loadSentCode(storage)).toEqual(sent);
  });

  it('gives nothing when none was saved, or the saved text is not a code', () => {
    expect(loadSentCode(store())).toBeNull();
    const storage = store();
    storage.setItem('classloom.sentCode', '{"schoolCode":1}');
    expect(loadSentCode(storage)).toBeNull();
    storage.setItem('classloom.sentCode', 'not json');
    expect(loadSentCode(storage)).toBeNull();
  });

  it('forgets the saved code when cleared', () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
    saveSentCode(sent, storage);
    clearSentCode(storage);
    expect(loadSentCode(storage)).toBeNull();
    expect(() =>
      clearSentCode({
        removeItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
  });

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => saveSentCode(sent, blocked)).not.toThrow();
    expect(loadSentCode(blocked)).toBeNull();
  });
});
