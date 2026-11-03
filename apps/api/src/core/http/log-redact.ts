/**
 * Paths pino-http must never log. pino-http's response serializer logs `res.getHeaders()`, so a
 * sign-in or cookie refresh would otherwise write the raw `set-cookie` session token.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.query.token',
];

const TOKEN_PARAM = /([?&]token=)[^&#]*/g;

/** The URL with every `token` query value replaced by `[Redacted]`: for logs and problem `instance`. */
export function redactUrl(url: string): string {
  return url.includes('token=') ? url.replace(TOKEN_PARAM, '$1[Redacted]') : url;
}

/**
 * pino-http request serializer (it receives the standard serialized request): a link token in
 * the query string (`GET /invitations/preview?token=…`) is a credential, so it never reaches the
 * logged URL. `req.query.token` is covered by `LOG_REDACT_PATHS`.
 */
export function redactRequest<T extends { url?: string }>(req: T): T {
  if (typeof req.url !== 'string' || !req.url.includes('token=')) return req;
  // The standard serializer's object has a non-enumerable `raw`; assign onto it, don't spread.
  req.url = redactUrl(req.url);
  return req;
}
