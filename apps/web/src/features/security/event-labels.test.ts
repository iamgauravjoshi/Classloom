import { AUTH_EVENT_TYPES, AUTH_METHODS } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import { eventLabelKey } from './event-labels';

const activity = messages.account.security.activity as Record<string, unknown>;

/** Follows a dotted key through the `account.security.activity` messages. */
function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      activity,
    );
}

describe('eventLabelKey', () => {
  // Iterates the contract's list: a new event type without a label fails here.
  for (const type of AUTH_EVENT_TYPES) {
    for (const method of [null, ...AUTH_METHODS]) {
      it(`has a label for ${type} with method ${String(method)}`, () => {
        const key = eventLabelKey(type, method);
        expect(key.startsWith('events.')).toBe(true);
        expect(typeof lookup(key), key).toBe('string');
      });
    }
  }

  it('names the method for sign-ins', () => {
    expect(eventLabelKey('SIGN_IN_SUCCEEDED', 'PASSWORD')).toBe(
      'events.SIGN_IN_SUCCEEDED.PASSWORD',
    );
    expect(eventLabelKey('SIGN_IN_SUCCEEDED', null)).toBe('events.SIGN_IN_SUCCEEDED.OTHER');
    expect(eventLabelKey('SIGN_IN_FAILED', 'EMAIL_CODE')).toBe('events.SIGN_IN_FAILED.EMAIL_CODE');
  });

  it('ignores the method for other events', () => {
    expect(eventLabelKey('PASSWORD_CHANGED', 'PASSWORD')).toBe('events.PASSWORD_CHANGED');
    expect(eventLabelKey('SESSION_REVOKED', null)).toBe('events.SESSION_REVOKED');
  });

  it('gives every label distinct text', () => {
    const perKey = new Map<string, unknown>();
    for (const type of AUTH_EVENT_TYPES) {
      for (const method of [null, ...AUTH_METHODS]) {
        const key = eventLabelKey(type, method);
        perKey.set(key, lookup(key));
      }
    }
    expect(new Set(perKey.values()).size).toBe(perKey.size);
  });
});
