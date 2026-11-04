import { parseEnv } from '../core/config/env.schema';
import { CliModule } from './cli.module';

const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://classloom_app:classloom_app@localhost:5432/classloom',
  SMTP_URL: 'smtp://localhost:1025',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'test-auth-secret-0123456789-abcdefghij',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'classloom-dev',
  S3_ACCESS_KEY: 'classloom',
  S3_SECRET_KEY: 'classloom-secret',
});

describe('CliModule', () => {
  it('refuses to start without the owner-role database URL', () => {
    expect(() => CliModule.forRoot(env)).toThrow(/DATABASE_MIGRATION_URL/);
  });

  it('starts with the owner-role database URL', () => {
    const migrationUrl = 'postgresql://classloom_owner:classloom_owner@localhost:5432/classloom';
    expect(CliModule.forRoot({ ...env, DATABASE_MIGRATION_URL: migrationUrl }).module).toBe(
      CliModule,
    );
  });
});
