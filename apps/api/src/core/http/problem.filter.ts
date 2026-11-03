import { STATUS_CODES } from 'node:http';

import type { ProblemDetails } from '@classloom/contracts';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';

import type { Env } from '../config/env.schema';
import { redactUrl } from './log-redact';

type ProblemBody = ProblemDetails & { stack?: string };

const titleFor = (status: number) => STATUS_CODES[status] ?? 'Error';

/** Renders every error as RFC 7807 `application/problem+json`; internals never leak in production. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  constructor(private readonly nodeEnv: Env['NODE_ENV']) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const body = this.toProblem(exception);
    // A link token in the query string is a credential: never echo it back.
    body.instance = redactUrl(req.url);
    res.status(body.status).setHeader('content-type', 'application/problem+json');
    if (body.retryAfter !== undefined) res.setHeader('Retry-After', String(body.retryAfter));
    res.send(JSON.stringify(body));
  }

  private toProblem(exception: unknown): ProblemBody {
    if (exception instanceof ZodValidationException) {
      const error = exception.getZodError() as ZodError;
      return {
        type: 'about:blank',
        title: titleFor(400),
        status: 400,
        detail: 'Validation failed',
        errors: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const extras = extrasOf(response);
      const title = extras.title ?? titleFor(status);
      const detail = detailOf(response);
      return {
        type: 'about:blank',
        status,
        ...(detail && detail !== title ? { detail } : {}),
        ...extras,
        title,
      };
    }
    this.logger.error(exception);
    const problem: ProblemBody = { type: 'about:blank', title: titleFor(500), status: 500 };
    if (this.nodeEnv !== 'production' && exception instanceof Error) {
      problem.detail = exception.message;
      problem.stack = exception.stack;
    }
    return problem;
  }
}

/**
 * Fields a service attached to an HttpException body: `errors[]`, a `suggestion`, and the
 * problem `type`, `title`, `retryAfter` seconds, `attemptsLeft`, `schoolCode` and `reason` for errors the
 * client acts on.
 */
function extrasOf(
  response: string | object,
): Partial<
  Pick<
    ProblemDetails,
    | 'errors'
    | 'suggestion'
    | 'type'
    | 'title'
    | 'retryAfter'
    | 'attemptsLeft'
    | 'schoolCode'
    | 'reason'
  >
> {
  if (typeof response === 'string') return {};
  const { errors, suggestion, type, title, retryAfter, attemptsLeft, schoolCode, reason } =
    response as Record<string, unknown>;
  return {
    ...(Array.isArray(errors) ? { errors: errors as ProblemDetails['errors'] } : {}),
    ...(typeof suggestion === 'string' ? { suggestion } : {}),
    ...(typeof type === 'string' ? { type } : {}),
    ...(typeof title === 'string' ? { title } : {}),
    ...(typeof retryAfter === 'number' ? { retryAfter } : {}),
    ...(typeof attemptsLeft === 'number' ? { attemptsLeft } : {}),
    ...(typeof schoolCode === 'string' ? { schoolCode } : {}),
    ...(typeof reason === 'string' ? { reason } : {}),
  };
}

function detailOf(response: string | object): string | undefined {
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return undefined;
}
