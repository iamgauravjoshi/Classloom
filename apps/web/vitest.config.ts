import { fileURLToPath } from 'node:url';

import { sharedVitestConfig } from '@classloom/config/vitest.shared';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  sharedVitestConfig,
  defineConfig({
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: { globals: true, environment: 'node' },
  }),
);
