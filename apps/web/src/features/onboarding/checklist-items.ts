import type { OnboardingItemKey } from '@classloom/contracts';

/**
 * Where a checklist item leads: the wizard's own step, except `academics`, which the wizard
 * doesn't have (academics spec section 9), so it opens the classes page.
 */
export const checklistHref = (key: OnboardingItemKey): string =>
  key === 'academics' ? '/classes' : `/onboarding?step=${key}`;

/** How many items are done, out of all of them. */
export function checklistProgress(items: readonly { done: boolean }[]): {
  done: number;
  total: number;
} {
  return { done: items.filter((item) => item.done).length, total: items.length };
}
