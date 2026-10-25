import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` does not need a database, so a missing URL must not fail CI builds.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/unset' },
});
