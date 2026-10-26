import { type ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';

import { ProblemFilter } from './problem.filter';

function mockHost(url = '/students') {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    send(body: unknown) {
      this.body = typeof body === 'string' ? JSON.parse(body) : body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url }) }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

type Body = Record<string, unknown> & { errors?: { path: string; message: string }[] };

describe('ProblemFilter', () => {
  it('maps HttpException to problem+json with its status and title', () => {
    const { host, res } = mockHost('/nope');
    new ProblemFilter('production').catch(new NotFoundException(), host);
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toBe('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      instance: '/nope',
    });
  });

  it('keeps a custom HttpException message as the detail', () => {
    const { host, res } = mockHost();
    new ProblemFilter('production').catch(new BadRequestException('Section is full'), host);
    expect(res.body).toMatchObject({
      status: 400,
      title: 'Bad Request',
      detail: 'Section is full',
    });
  });

  it('maps zod validation errors to 400 with field errors', () => {
    const { host, res } = mockHost();
    const schema = z.object({ email: z.email() });
    const result = schema.safeParse({ email: 'nope' });
    if (result.success) throw new Error('expected failure');
    new ProblemFilter('production').catch(new ZodValidationException(result.error), host);
    expect(res.statusCode).toBe(400);
    expect((res.body as Body).errors).toEqual([
      { path: 'email', message: expect.any(String) as string },
    ]);
  });

  it('hides internals of unknown errors in production', () => {
    const { host, res } = mockHost();
    new ProblemFilter('production').catch(new Error('boom: password=secret'), host);
    expect(res.statusCode).toBe(500);
    const body = res.body as Body;
    expect(body.title).toBe('Internal Server Error');
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toContain('boom');
  });

  it('includes the stack for unknown errors outside production', () => {
    const { host, res } = mockHost();
    new ProblemFilter('development').catch(new Error('boom'), host);
    expect((res.body as Body).stack).toEqual(expect.stringContaining('boom'));
  });
});
