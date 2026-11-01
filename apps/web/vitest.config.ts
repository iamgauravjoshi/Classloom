import { fileURLToPath } from 'node:url';

import { sharedVitestConfig } from '@classloom/config/vitest.shared';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  sharedVitestConfig,
  defineConfig({
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    // Next's tsconfig keeps JSX as-is (`preserve`); component tests need it compiled.
    oxc: { jsx: { runtime: 'automatic' } },
    test: {
      globals: true,
      environment: 'node',
      // next-intl imports `next/navigation` without an extension, which Node's ESM loader refuses;
      // inlined, Vite resolves it (and `vi.mock('next/navigation')` reaches it).
      server: { deps: { inline: ['next-intl'] } },
    },
  }),
);
