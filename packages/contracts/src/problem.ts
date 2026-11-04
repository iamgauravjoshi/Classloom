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
  /** Set on a 409 `invitation-joined`: the school the person joined, to sign in to. */
  schoolCode: z.string().optional(),
  /** Set on a 422 `logo-invalid`: why the image was refused (`type`, `size`, `dimensions`, `decode`). */
  reason: z.string().optional(),
  /** Set on a 409 `name-taken`: the request field whose value is taken (e.g. `name`). */
  field: z.string().optional(),
  /** Set on a 409 `academics-limit`: the most allowed. */
  limit: z.number().int().optional(),
  /** Set on a 409 `in-use`: how many rows of each kind still use the item. */
  counts: z.record(z.string(), z.number().int()).optional(),
  /** Set on a 409 `teacher-taken`: the section the teacher already leads that year. */
  sectionName: z.string().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
