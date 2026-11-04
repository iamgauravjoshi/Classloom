import { describe, expect, it, vi } from 'vitest';

import { holdUnload } from './leave-guard-events';

describe('holdUnload', () => {
  it('asks the browser to confirm both ways: preventDefault and an empty returnValue', () => {
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    holdUnload(event as unknown as BeforeUnloadEvent);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    // Older Chromium and WebKit only ask when returnValue is set.
    expect(event.returnValue).toBe('');
  });
});
