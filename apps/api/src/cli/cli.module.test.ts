import { parseEnv } from '../core/config/env.schema';
import { CliModule } from './cli.module';

const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://classloom_app:classloom_app@localhost:5432/classloom',
  SMTP_URL: 'smtp://localhost:1025',
  REDIS_URL: 'redis://localhost:6379',
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
