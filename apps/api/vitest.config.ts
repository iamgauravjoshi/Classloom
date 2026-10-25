import { sharedVitestConfig } from '@classloom/config/vitest.shared';
import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  sharedVitestConfig,
  defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: { globals: true, environment: 'node' },
  }),
);
