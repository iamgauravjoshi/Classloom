import { act, renderHook } from '@testing-library/react';

import { useIsMobile } from './use-mobile';

type Listener = () => void;

function mockViewport(width: number) {
  const listeners = new Set<Listener>();
  let current = width;
  window.matchMedia = vi.fn((query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1]);
    return {
      get matches() {
        return current <= max;
      },
      media: query,
      addEventListener: (_: string, cb: Listener) => listeners.add(cb),
      removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
    } as unknown as MediaQueryList;
  });
  return {
    resize(next: number) {
      current = next;
      listeners.forEach((cb) => cb());
    },
  };
}

describe('useIsMobile', () => {
  it('treats widths below the lg breakpoint (1024px) as mobile, including iPad portrait', () => {
    mockViewport(820);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
  });

  it('treats 1024px and wider as desktop', () => {
    mockViewport(1024);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it('updates when the viewport crosses the breakpoint', () => {
    const viewport = mockViewport(1280);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => viewport.resize(375));
    expect(result.current).toBe(true);
  });
});
