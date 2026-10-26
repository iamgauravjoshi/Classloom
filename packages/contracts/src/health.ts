import { z } from 'zod';

const checkState = z.enum(['up', 'down']);

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({ database: checkState, redis: checkState }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
