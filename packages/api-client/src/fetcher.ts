import { type ProblemDetails, problemDetailsSchema } from '@classloom/contracts';

/** Request shape Orval passes to its custom mutator. */
export interface ApiRequestConfig {
  url: string;
  method: string;
  params?: object;
  data?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  /** `blob` for binary responses (the school logo); JSON otherwise. */
  responseType?: 'blob';
}

/** Any non-2xx API response; `problem` is the RFC 7807 body (synthesised when the body is not JSON). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
}

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * In the browser, the web app's own `/api` rewrite (same site, so the session cookie is first
 * party); on the server, the API directly. Read per call: tests and the server set it at runtime.
 */
function baseUrl(): string {
  if (typeof window !== 'undefined') return `${window.location.origin}/api`;
  return process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
}

function buildUrl(url: string, params?: object): string {
  // Concatenated, not `new URL(url, base)`: a leading `/` in `url` would drop the `/api` prefix.
  const target = new URL(baseUrl() + url);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
  }
  return target.toString();
}

const synthesise = (status: number, title = STATUS_TITLES[status] ?? 'Error'): ProblemDetails => ({
  type: 'about:blank',
  title,
  status,
});

/** The RFC 7807 body when the API sent one; anything else (proxy pages, foreign JSON) is synthesised. */
async function readProblem(res: Response): Promise<ProblemDetails> {
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      const parsed = problemDetailsSchema.safeParse(await res.json());
      if (parsed.success) return parsed.data;
    } catch {
      // fall through to a synthesised problem
    }
  }
  return synthesise(res.status);
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * Orval mutator: `fetch` against the Classloom API with cookies, JSON or multipart bodies and
 * problem+json errors.
 */
export async function apiFetch<T>(config: ApiRequestConfig): Promise<T> {
  const headers = new Headers(config.headers);
  const hasBody = config.data !== undefined;
  const isForm = config.data instanceof FormData;
  // fetch sets a multipart content type with its boundary; a preset one would lack it.
  if (isForm) headers.delete('content-type');
  else if (hasBody) headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(buildUrl(config.url, config.params), {
      method: config.method.toUpperCase(),
      headers,
      body: isForm ? (config.data as FormData) : hasBody ? JSON.stringify(config.data) : undefined,
      credentials: 'same-origin',
      signal: config.signal,
    });
  } catch (error) {
    // Aborts must propagate as-is so TanStack Query treats them as cancellations.
    if (isAbort(error)) throw error;
    throw new ApiError(0, synthesise(0, 'Network Error'));
  }
  if (!res.ok) throw new ApiError(res.status, await readProblem(res));
  if (res.status === 204) return undefined as T;
  if (config.responseType === 'blob') return (await res.blob()) as T;
  // A 2xx may carry no body at all (the forgot-password 202), which `res.json()` rejects.
  const text = await res.text();
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

/** Tells Orval that generated hooks reject with `ApiError`, whatever the OpenAPI error schema says. */
export type ErrorType<_Error> = ApiError;
