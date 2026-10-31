/**
 * Paths pino-http must never log. pino-http's response serializer logs `res.getHeaders()`, so a
 * sign-in or cookie refresh would otherwise write the raw `set-cookie` session token.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];
