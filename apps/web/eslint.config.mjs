import { next } from '@classloom/config/eslint/next';

export default [
  ...next(import.meta.dirname),
  {
    ignores: ['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**', 'public/**'],
  },
];
