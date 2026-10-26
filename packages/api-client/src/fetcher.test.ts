import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiFetch } from './fetcher';

function respond(status: number, body: string, contentType: string) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': contentType } })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('resolves JSON bodies for 2xx responses', async () => {
    const body = { status: 'ok', checks: { database: 'up', redis: 'up' } };
    respond(200, JSON.stringify(body), 'application/json');
    await expect(apiFetch({ url: '/health', method: 'GET' })).resolves.toEqual(body);
  });

  it('sends cookies, query params and JSON bodies to the API base URL', async () => {
    const fetchMock = respond(200, '{}', 'application/json');
    await apiFetch({
      url: '/students',
      method: 'POST',
      params: { page: 2 },
      data: { name: 'Asha' },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/students?page=2');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('{"name":"Asha"}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('throws ApiError carrying the problem details', async () => {
    respond(
      404,
      JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404 }),
      'application/problem+json',
    );
    const error = await apiFetch({ url: '/x', method: 'GET' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, problem: { title: 'Not Found' } });
  });

  it('synthesises a problem for non-JSON errors from proxies', async () => {
    respond(502, '<html>Bad gateway</html>', 'text/html');
    await expect(apiFetch({ url: '/x', method: 'GET' })).rejects.toMatchObject({
      status: 502,
      problem: { title: 'Bad Gateway', status: 502 },
    });
  });

  it('returns undefined for 204 No Content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    await expect(apiFetch({ url: '/x', method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('apiFetch error normalisation', () => {
  it('synthesises a problem when a JSON error body is not problem details', async () => {
    respond(502, JSON.stringify({ message: 'upstream down' }), 'application/json');
    await expect(apiFetch({ url: '/x', method: 'GET' })).rejects.toMatchObject({
      status: 502,
      problem: { type: 'about:blank', title: 'Bad Gateway', status: 502 },
    });
  });

  it('wraps network failures in ApiError with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const error = await apiFetch({ url: '/x', method: 'GET' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, problem: { title: 'Network Error', status: 0 } });
  });

  it('lets aborts propagate unchanged so TanStack Query can cancel', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(abort)),
    );
    await expect(apiFetch({ url: '/x', method: 'GET' })).rejects.toBe(abort);
  });
});
