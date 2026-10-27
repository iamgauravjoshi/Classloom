import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { RequestAuth } from './request-auth';

/** The caller's `RequestAuth`. Undefined on a `@Public()` route reached without a session. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestAuth =>
    context.switchToHttp().getRequest<Request>().auth as RequestAuth,
);
