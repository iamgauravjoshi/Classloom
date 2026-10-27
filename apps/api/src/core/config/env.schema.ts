import { z } from 'zod';

const envSchema = z.object({
  // Required: defaulting to development would expose stack traces if a deploy forgot it.
  NODE_ENV: z.enum(['development', 'test', 'production']),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Owner role (BYPASSRLS): migrations and the platform CLI only. The API never needs it.
  DATABASE_MIGRATION_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  EMAIL_FROM: z.string().min(1).default('Classloom <no-reply@classloom.local>'),
  REGISTRATION_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  CODE_AVAILABILITY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  // Per client address, on resend and cancel (each counted on its own).
  RESEND_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(10),
  REGISTRATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(24),
  PENDING_TENANT_TTL_HOURS: z.coerce.number().int().positive().default(48),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

/** Validates the process environment once at startup, reporting every bad key together. */
export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n${problems.join('\n')}`);
  }
  return result.data;
}
