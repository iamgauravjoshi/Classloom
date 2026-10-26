import { z } from 'zod';

/** RFC 7807 problem details, the error body of every API response. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** Set on a 409 for a taken school code: the next free code. */
  suggestion: z.string().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
