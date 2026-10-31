import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ cookie: 'cl_session=abc' })),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { getServerSession } = await import('./server-session');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getServerSession', () => {
  it('forwards the cookie and asks the API not to slide the session', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getServerSession();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/auth/session');
    const sent = new Headers(init.headers);
    expect(sent.get('cookie')).toBe('cl_session=abc');
    expect(sent.get('x-session-touch')).toBe('skip');
    expect(init.cache).toBe('no-store');
  });
});
