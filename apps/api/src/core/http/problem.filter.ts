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
    body.instance = req.url;
    res
      .status(body.status)
      .setHeader('content-type', 'application/problem+json')
      .send(JSON.stringify(body));
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
      const title = titleFor(status);
      const response = exception.getResponse();
      const detail = detailOf(response);
      return {
        type: 'about:blank',
        title,
        status,
        ...(detail && detail !== title ? { detail } : {}),
        ...extrasOf(response),
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

/** Field `errors[]` and a `suggestion` that a service attached to an HttpException body. */
function extrasOf(response: string | object): Pick<ProblemDetails, 'errors' | 'suggestion'> {
  if (typeof response === 'string') return {};
  const { errors, suggestion } = response as { errors?: unknown; suggestion?: unknown };
  return {
    ...(Array.isArray(errors) ? { errors: errors as ProblemDetails['errors'] } : {}),
    ...(typeof suggestion === 'string' ? { suggestion } : {}),
  };
}

function detailOf(response: string | object): string | undefined {
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return undefined;
}
