// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en.json';
import { VerifyInvalid, VerifySuccess } from './verify-result';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/en/register-school/verify',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const verify = messages.registration.verify;

const renderInIntl = (element: React.ReactElement) =>
  render(
    createElement(QueryClientProvider, {
      client: new QueryClient(),
      children: createElement(NextIntlClientProvider, {
        locale: 'en',
        messages,
        children: element,
      }),
    }),
  );

afterEach(cleanup);

describe('verification page copy for a link that no longer works', () => {
  it('keeps "no longer valid" in the heading', () => {
    expect(verify.invalidTitle).toContain('no longer valid');
  });

  it('tells a used-link visitor the school is ready and an expired-link visitor what to do', () => {
    expect(verify.invalidBody).toBe(
      'If you already opened this link, your school is ready and you can sign in. ' +
        'If it expired, request a new link below.',
    );
  });

  it('no longer says sign-in arrives later', () => {
    expect(JSON.stringify(messages.registration)).not.toMatch(/arrives/i);
  });

  it('offers a Sign in link on the invalid-link view', () => {
    renderInIntl(createElement(VerifyInvalid));
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/en/sign-in');
  });
});

describe('verification success', () => {
  it('has a "Sign in" link to the sign-in page with the school code filled in', () => {
    renderInIntl(
      createElement(VerifySuccess, { code: 'GISD', name: 'Global International School' }),
    );
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/en/sign-in?school=GISD',
    );
  });
});
