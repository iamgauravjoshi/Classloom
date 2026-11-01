import { Writable } from 'node:stream';

import pino from 'pino';

import { LOG_REDACT_PATHS } from './log-redact';

describe('LOG_REDACT_PATHS', () => {
  it('keeps the session token out of request and response headers', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = pino({ redact: LOG_REDACT_PATHS }, stream);
    logger.info({
      req: { headers: { cookie: 'cl_session=secret-in', authorization: 'Bearer secret-auth' } },
      res: { headers: { 'set-cookie': ['cl_session=secret-out; HttpOnly'] } },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/secret/);
    expect(lines[0]).toContain('[Redacted]');
  });
});
