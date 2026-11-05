import { ONBOARDING_ITEMS } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { checklistHref, checklistProgress } from './checklist-items';

describe('checklist items', () => {
  it('counts all 5 items, done or not', () => {
    const items = ONBOARDING_ITEMS.map((key, i) => ({ key, done: i < 2 }));
    expect(checklistProgress(items)).toEqual({ done: 2, total: 5 });
  });

  it('links each wizard item to its step and academics to the classes page', () => {
    expect(ONBOARDING_ITEMS.map(checklistHref)).toEqual([
      '/onboarding?step=profile',
      '/onboarding?step=logo',
      '/onboarding?step=academicYear',
      '/onboarding?step=campuses',
      '/classes',
    ]);
  });

  it('has a label for every item', () => {
    for (const key of ONBOARDING_ITEMS) {
      expect(en.onboarding.checklist.items[key]).toEqual(expect.any(String));
    }
  });
});
