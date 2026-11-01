import '@testing-library/jest-dom/vitest';

// jsdom lacks elementFromPoint, which input-otp calls for its password-manager badge check.
Object.defineProperty(document, 'elementFromPoint', { value: () => null, configurable: true });
