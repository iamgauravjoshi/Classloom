import { parseEnv } from './env.schema';

const validEnv = {
  NODE_ENV: 'development',
  API_PORT: '4000',
  DATABASE_URL: 'postgresql://classloom_app:classloom_app@localhost:5432/classloom',
  DATABASE_MIGRATION_URL: 'postgresql://classloom_owner:classloom_owner@localhost:5432/classloom',
  SMTP_URL: 'smtp://localhost:1025',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:3000',
  AUTH_SECRET: 'test-auth-secret-0123456789-abcdefghij',
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
      AUTH_SECRET: validEnv.AUTH_SECRET,
    });
    expect(env).toMatchObject({
      API_PORT: 4000,
      WEB_ORIGIN: 'http://localhost:3000',
      EMAIL_FROM: 'Classloom <no-reply@classloom.local>',
      REGISTRATION_RATE_LIMIT_PER_HOUR: 5,
      CODE_AVAILABILITY_RATE_LIMIT_PER_MINUTE: 60,
      RESEND_RATE_LIMIT_PER_HOUR: 10,
      REGISTRATION_TOKEN_TTL_HOURS: 24,
      PENDING_TENANT_TTL_HOURS: 48,
    });
  });

  it('does not require the owner-role migration URL (only migrations and the CLI use it)', () => {
    const { DATABASE_MIGRATION_URL: _omit, ...rest } = validEnv;
    expect(parseEnv(rest).DATABASE_MIGRATION_URL).toBeUndefined();
  });

  it('still validates the migration URL when it is set', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_MIGRATION_URL: 'not a url' })).toThrow(
      /DATABASE_MIGRATION_URL/,
    );
  });

  it('reads the per-address resend limit and rejects a non-positive or fractional one', () => {
    expect(
      parseEnv({ ...validEnv, RESEND_RATE_LIMIT_PER_HOUR: '25' }).RESEND_RATE_LIMIT_PER_HOUR,
    ).toBe(25);
    expect(() => parseEnv({ ...validEnv, RESEND_RATE_LIMIT_PER_HOUR: '0' })).toThrow(
      /RESEND_RATE_LIMIT_PER_HOUR/,
    );
    expect(() => parseEnv({ ...validEnv, RESEND_RATE_LIMIT_PER_HOUR: '2.5' })).toThrow(
      /RESEND_RATE_LIMIT_PER_HOUR/,
    );
  });

  it('rejects a non-SMTP SMTP_URL', () => {
    expect(() => parseEnv({ ...validEnv, SMTP_URL: 'http://x' })).toThrow(/SMTP_URL/);
  });

  it('rejects a malformed database URL', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/);
  });

  describe('auth settings', () => {
    it('requires AUTH_SECRET', () => {
      const { AUTH_SECRET: _omit, ...rest } = validEnv;
      expect(() => parseEnv(rest)).toThrow(/AUTH_SECRET/);
    });

    it('rejects an AUTH_SECRET shorter than 32 characters and accepts exactly 32', () => {
      expect(() => parseEnv({ ...validEnv, AUTH_SECRET: 'x'.repeat(31) })).toThrow(/AUTH_SECRET/);
      expect(parseEnv({ ...validEnv, AUTH_SECRET: 'x'.repeat(32) }).AUTH_SECRET).toBe(
        'x'.repeat(32),
      );
    });

    it('defaults COOKIE_SECURE from NODE_ENV', () => {
      expect(parseEnv({ ...validEnv, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
      expect(parseEnv({ ...validEnv, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false);
      expect(parseEnv({ ...validEnv, NODE_ENV: 'test' }).COOKIE_SECURE).toBe(false);
    });

    it('lets COOKIE_SECURE override the NODE_ENV default in both directions', () => {
      expect(
        parseEnv({ ...validEnv, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).COOKIE_SECURE,
      ).toBe(false);
      expect(
        parseEnv({ ...validEnv, NODE_ENV: 'development', COOKIE_SECURE: 'true' }).COOKIE_SECURE,
      ).toBe(true);
    });

    it('rejects a COOKIE_SECURE that is not true or false', () => {
      expect(() => parseEnv({ ...validEnv, COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
    });

    it('defaults TRUST_PROXY to loopback and reads an override', () => {
      expect(parseEnv(validEnv).TRUST_PROXY).toBe('loopback');
      expect(parseEnv({ ...validEnv, TRUST_PROXY: '10.0.0.0/8' }).TRUST_PROXY).toBe('10.0.0.0/8');
    });

    it('defaults the three sign-in limits to 30, 10 and 10 and reads overrides', () => {
      expect(parseEnv(validEnv)).toMatchObject({
        SIGN_IN_RATE_LIMIT_PER_15_MIN: 30,
        CODE_REQUEST_RATE_LIMIT_PER_HOUR: 10,
        PASSWORD_RESET_RATE_LIMIT_PER_HOUR: 10,
      });
      expect(
        parseEnv({ ...validEnv, SIGN_IN_RATE_LIMIT_PER_15_MIN: '500' })
          .SIGN_IN_RATE_LIMIT_PER_15_MIN,
      ).toBe(500);
      expect(() => parseEnv({ ...validEnv, CODE_REQUEST_RATE_LIMIT_PER_HOUR: '0' })).toThrow(
        /CODE_REQUEST_RATE_LIMIT_PER_HOUR/,
      );
    });
  });
});
