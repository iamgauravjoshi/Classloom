import { react } from '@classloom/config/eslint/react';

export default [...react(import.meta.dirname), { ignores: ['storybook-static/**'] }];
