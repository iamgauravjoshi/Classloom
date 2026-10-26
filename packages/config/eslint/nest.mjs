import globals from 'globals';

import { base } from './base.mjs';

export function nest(tsconfigRootDir) {
  return [
    ...base(tsconfigRootDir),
    {
      languageOptions: { globals: { ...globals.node } },
      rules: {
        // Nest relies on classes used only via decorators/DI.
        '@typescript-eslint/no-extraneous-class': 'off',
      },
    },
  ];
}
