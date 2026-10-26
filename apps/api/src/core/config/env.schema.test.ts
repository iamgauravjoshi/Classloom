import { parseEnv } from './env.schema';

const validEnv = {
  NODE_ENV: 'development',
  API_PORT: '4000',
  DATABASE_URL: 'postgresql://classloom_app:classloom_app@localhost:5432/classloom',
  DATABASE_MIGRATION_URL: 'postgresql://classloom_owner:classloom_owner@localhost:5432/classloom',
  SMTP_URL: 'smtp://localhost:1025',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('parseEnv', () => {
  it('lists every missing required key in one error', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/);
  });

  it('coerces the port to a number', () => {
    expect(parseEnv(validEnv).API_PORT).toBe(4000);
  });

  it('requires NODE_ENV so production never silently runs as development', () => {
    const { NODE_ENV: _omit, ...rest } = validEnv;
    expect(() => parseEnv(rest)).toThrow(/NODE_ENV/);
  });

  it('defaults API_PORT and WEB_ORIGIN', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      DATABASE_URL: validEnv.DATABASE_URL,
      DATABASE_MIGRATION_URL: validEnv.DATABASE_MIGRATION_URL,
      SMTP_URL: validEnv.SMTP_URL,
      REDIS_URL: validEnv.REDIS_URL,
    });
    expect(env).toMatchObject({
      API_PORT: 4000,
      WEB_ORIGIN: 'http://localhost:3000',
      EMAIL_FROM: 'Classloom <no-reply@classloom.local>',
      REGISTRATION_RATE_LIMIT_PER_HOUR: 5,
      REGISTRATION_TOKEN_TTL_HOURS: 24,
      PENDING_TENANT_TTL_HOURS: 48,
    });
  });

  it('requires the migration database URL', () => {
    const { DATABASE_MIGRATION_URL: _omit, ...rest } = validEnv;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_MIGRATION_URL/);
  });

  it('rejects a non-SMTP SMTP_URL', () => {
    expect(() => parseEnv({ ...validEnv, SMTP_URL: 'http://x' })).toThrow(/SMTP_URL/);
  });

  it('rejects a malformed database URL', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/);
  });
});
