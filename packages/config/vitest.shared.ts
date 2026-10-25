import type { ViteUserConfig } from 'vitest/config';

export const sharedVitestConfig = {
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    restoreMocks: true,
  },
} satisfies ViteUserConfig;
