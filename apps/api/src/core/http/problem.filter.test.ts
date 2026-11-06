import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
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

  it('carries a custom type, title and retryAfter, and sends Retry-After', () => {
    const { host, res } = mockHost();
    new ProblemFilter('production').catch(
      new HttpException(
        { message: 'Paused', type: 'sign-in-paused', title: 'Paused.', retryAfter: 90 },
        429,
      ),
      host,
    );
    expect(res.body).toMatchObject({
      type: 'sign-in-paused',
      title: 'Paused.',
      status: 429,
      retryAfter: 90,
    });
    expect(res.headers['retry-after']).toBe('90');
  });

  it('carries attemptsLeft for two-factor-invalid, including 0', () => {
    for (const attemptsLeft of [3, 0]) {
      const { host, res } = mockHost();
      new ProblemFilter('production').catch(
        new HttpException({ type: 'two-factor-invalid', title: 'Wrong.', attemptsLeft }, 401),
        host,
      );
      expect(res.body).toMatchObject({ type: 'two-factor-invalid', status: 401, attemptsLeft });
    }
  });

  it('never echoes a link token back in instance', () => {
    const { host, res } = mockHost('/invitations/preview?token=secret-token&x=1');
    new ProblemFilter('production').catch(new HttpException('Gone', 410), host);
    expect((res.body as Body).instance).toBe('/invitations/preview?token=[Redacted]&x=1');
    expect(JSON.stringify(res.body)).not.toContain('secret-token');
  });

  it('carries schoolCode for invitation-joined', () => {
    const { host, res } = mockHost('/invitations/accept');
    new ProblemFilter('production').catch(
      new HttpException({ type: 'invitation-joined', title: 'Joined.', schoolCode: 'GIS' }, 409),
      host,
    );
    expect(res.body).toMatchObject({ type: 'invitation-joined', status: 409, schoolCode: 'GIS' });
  });

  it('carries reason for logo-invalid', () => {
    const { host, res } = mockHost('/school/logo');
    new ProblemFilter('production').catch(
      new HttpException({ type: 'logo-invalid', title: 'Bad logo.', reason: 'size' }, 422),
      host,
    );
    expect(res.body).toMatchObject({ type: 'logo-invalid', status: 422, reason: 'size' });
  });

  it('carries field, limit, counts and sectionName for the academics problems', () => {
    const { host, res } = mockHost('/academics/streams');
    new ProblemFilter('production').catch(
      new HttpException(
        {
          type: 'in-use',
          title: 'In use.',
          field: 'name',
          limit: 20,
          counts: { sections: 0, classSubjects: 1 },
          sectionName: 'A',
        },
        409,
      ),
      host,
    );
    expect(res.body).toMatchObject({
      type: 'in-use',
      field: 'name',
      limit: 20,
      counts: { sections: 0, classSubjects: 1 },
      sectionName: 'A',
    });
  });

  it('drops counts that are not a record of numbers', () => {
    const { host, res } = mockHost();
    new ProblemFilter('production').catch(
      new HttpException({ type: 'in-use', title: 'In use.', counts: { x: 'many' } }, 409),
      host,
    );
    expect((res.body as Body).counts).toBeUndefined();
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

  it('passes errors[] and suggestion from an HttpException body through', () => {
    const { host, res } = mockHost();
    new ProblemFilter('production').catch(
      new ConflictException({
        message: 'Code taken',
        errors: [{ path: 'code', message: 'This school code is already taken.' }],
        suggestion: 'GISD-2',
      }),
      host,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      detail: 'Code taken',
      errors: [{ path: 'code', message: 'This school code is already taken.' }],
      suggestion: 'GISD-2',
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
