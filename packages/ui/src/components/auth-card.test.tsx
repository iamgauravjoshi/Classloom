import { render, screen } from '@testing-library/react';

import { AuthCard } from './auth-card';

describe('AuthCard', () => {
  it('renders the title as the page h1 with description and children', () => {
    render(
      <AuthCard title="Sign in" description="Enter your details">
        <p>form</p>
      </AuthCard>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Enter your details')).toBeInTheDocument();
    expect(screen.getByText('form')).toBeInTheDocument();
  });

  it('renders logo, footer and copyright when given', () => {
    render(
      <AuthCard
        title="Sign in"
        logo={<span>Logo</span>}
        footer={<a href="/x">Forgot?</a>}
        copyright="© Classloom"
      >
        body
      </AuthCard>,
    );
    expect(screen.getByText('Logo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot?' })).toBeInTheDocument();
    expect(screen.getByText('© Classloom')).toBeInTheDocument();
  });
});
