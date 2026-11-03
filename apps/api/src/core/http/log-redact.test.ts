import { Writable } from 'node:stream';

import pino from 'pino';

import { LOG_REDACT_PATHS, redactRequest, redactUrl } from './log-redact';

describe('redactUrl', () => {
  it('replaces every token value and leaves other URLs alone', () => {
    expect(redactUrl('/invitations/preview?token=abc')).toBe(
      '/invitations/preview?token=[Redacted]',
    );
    expect(redactUrl('/x?a=1&token=abc#f')).toBe('/x?a=1&token=[Redacted]#f');
    expect(redactUrl('/schools?code=GIS')).toBe('/schools?code=GIS');
  });
});

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

describe('redactRequest', () => {
  it('keeps link tokens out of the logged URL and query', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = pino({ redact: LOG_REDACT_PATHS, serializers: { req: redactRequest } }, stream);
    logger.info({
      req: {
        method: 'GET',
        url: '/invitations/preview?a=1&token=secret-token&b=2',
        query: { a: '1', token: 'secret-token' },
      },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/secret/);
    expect(lines[0]).toContain('/invitations/preview?a=1&token=[Redacted]&b=2');
    expect(lines[0]).toContain('"a":"1"');
  });

  it('leaves other requests alone', () => {
    const req = { method: 'GET', url: '/schools/code-availability?code=GIS' };
    expect(redactRequest(req)).toEqual(req);
  });
});
