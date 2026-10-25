import { fileURLToPath } from 'node:url';

import { sharedVitestConfig } from '@classloom/config/vitest.shared';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  sharedVitestConfig,
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: { '@classloom/ui': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
    },
  }),
);
