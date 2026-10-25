import '../src/styles/globals.css';

import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    backgrounds: { disable: true },
  },
  decorators: [
    withThemeByClassName({ themes: { light: '', dark: 'dark' }, defaultTheme: 'light' }),
    (Story) => (
      <div className="bg-background p-4 font-sans text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default preview;
