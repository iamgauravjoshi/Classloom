import type { ProblemDetails } from '@classloom/contracts';

/** Request shape Orval passes to its custom mutator. */
export interface ApiRequestConfig {
  url: string;
  method: string;
  params?: object;
  data?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
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

// Literal `process.env.NEXT_PUBLIC_*` so Next.js inlines it into browser bundles.
const baseUrl = (): string => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function buildUrl(url: string, params?: object): string {
  const target = new URL(url, baseUrl());
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
  }
  return target.toString();
}

async function readProblem(res: Response): Promise<ProblemDetails> {
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      return (await res.json()) as ProblemDetails;
    } catch {
      // fall through to a synthesised problem
    }
  }
  return { type: 'about:blank', title: STATUS_TITLES[res.status] ?? 'Error', status: res.status };
}

/** Orval mutator: `fetch` against the Classloom API with cookies, JSON bodies and problem+json errors. */
export async function apiFetch<T>(config: ApiRequestConfig): Promise<T> {
  const headers = new Headers(config.headers);
  const hasBody = config.data !== undefined;
  if (hasBody) headers.set('content-type', 'application/json');
  const res = await fetch(buildUrl(config.url, config.params), {
    method: config.method.toUpperCase(),
    headers,
    body: hasBody ? JSON.stringify(config.data) : undefined,
    credentials: 'include',
    signal: config.signal,
  });
  if (!res.ok) throw new ApiError(res.status, await readProblem(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Tells Orval that generated hooks reject with `ApiError`, whatever the OpenAPI error schema says. */
export type ErrorType<_Error> = ApiError;
