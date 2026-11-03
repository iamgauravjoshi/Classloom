import { z } from 'zod';

const checkState = z.enum(['up', 'down']);

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  // Storage being down never fails the check: only uploads and logo reads depend on it.
  checks: z.object({ database: checkState, redis: checkState, storage: checkState }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
