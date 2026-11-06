import type { NumberSeriesKey, PatternProblem } from '@classloom/contracts';
import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';

/**
 * The problem types of the settings module (Part 6a spec section 7). Each exception carries its
 * `type`, a `title` and a `message` (rendered as `detail`) through `ProblemFilter`, plus the field
 * the client acts on.
 */
export type SettingsProblemType =
  'number-pattern-invalid' | 'next-number-too-low' | 'no-current-year';

/** 422: the pattern breaks a rule; `problem` names the first (see `parseNumberPattern`). */
export class NumberPatternInvalidException extends HttpException {
  constructor(readonly problem: PatternProblem) {
    super(
      {
        type: 'number-pattern-invalid' satisfies SettingsProblemType,
        title: 'This pattern is not valid.',
        message: 'Use letters, digits, / - _ and spaces, the year tokens, and {SEQ:n} once.',
        problem,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422: the next number must be above the last one issued; `minimum` is the lowest allowed. */
export class NextNumberTooLowException extends HttpException {
  constructor(readonly minimum: number) {
    super(
      {
        type: 'next-number-too-low' satisfies SettingsProblemType,
        title: 'This number has already been issued.',
        message: `The next number must be ${minimum} or more.`,
        minimum,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 409: a per-year series' next number is set for the current year, and there is none. */
export class NoCurrentYearException extends ConflictException {
  constructor() {
    super({
      type: 'no-current-year' satisfies SettingsProblemType,
      title: 'The school has no current academic year.',
      message: 'Set up an academic year first.',
    });
  }
}

/**
 * A series has issued its last number (99,999,999). Not an HTTP problem: callers that issue
 * numbers (Phase 2) decide how to report it.
 */
export class NumberSeriesExhausted extends Error {
  constructor(readonly key: NumberSeriesKey) {
    super(`Number series ${key} has issued its last number`);
    this.name = 'NumberSeriesExhausted';
  }
}
