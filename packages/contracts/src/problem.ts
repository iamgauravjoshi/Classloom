import { z } from 'zod';

/** RFC 7807 problem details, the error body of every API response. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
        /** Set on password policy errors: which rule failed (e.g. `common`). */
        code: z.string().optional(),
      }),
    )
    .optional(),
  /** Set on a 409 for a taken school code: the next free code. */
  suggestion: z.string().optional(),
  /** Set on a 429 `sign-in-paused`: seconds until the pause ends (also sent as `Retry-After`). */
  retryAfter: z.number().int().optional(),
  /** Set on a 401 `two-factor-invalid`: tries left on this sign-in challenge. */
  attemptsLeft: z.number().int().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
