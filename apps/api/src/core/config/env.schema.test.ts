import { parseEnv } from './env.schema';

const validEnv = {
  NODE_ENV: 'development',
  API_PORT: '4000',
  DATABASE_URL: 'postgresql://classloom:classloom@localhost:5432/classloom',
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

  it('defaults NODE_ENV, API_PORT and WEB_ORIGIN', () => {
    const env = parseEnv({ DATABASE_URL: validEnv.DATABASE_URL, REDIS_URL: validEnv.REDIS_URL });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 4000,
      WEB_ORIGIN: 'http://localhost:3000',
    });
  });

  it('rejects a malformed database URL', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/);
  });
});
