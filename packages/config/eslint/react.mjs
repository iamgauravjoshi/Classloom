import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { base } from './base.mjs';

export function react(tsconfigRootDir) {
  return [
    ...base(tsconfigRootDir),
    {
      languageOptions: { globals: { ...globals.browser } },
      plugins: { 'react-hooks': reactHooks },
      rules: { ...reactHooks.configs.recommended.rules },
    },
  ];
}
