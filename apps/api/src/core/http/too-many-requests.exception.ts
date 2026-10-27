import { HttpException, HttpStatus } from '@nestjs/common';

/** 429; NestJS ships no exception class for it. */
export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many requests. Try again later.') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
