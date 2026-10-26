import { render, screen } from '@testing-library/react';

import { StatusPill } from './status-pill';

describe('StatusPill', () => {
  it('uses the AA-safe strong text colour on the tint for its tone', () => {
    render(<StatusPill tone="success">Active</StatusPill>);
    const pill = screen.getByText('Active');
    expect(pill).toHaveClass('text-success-strong');
    expect(pill).toHaveClass('bg-success-tint');
  });

  it('renders the neutral tone with muted tokens', () => {
    render(<StatusPill tone="neutral">Draft</StatusPill>);
    expect(screen.getByText('Draft')).toHaveClass('text-muted-foreground');
  });

  it('includes a decorative dot hidden from assistive tech', () => {
    const { container } = render(<StatusPill tone="danger">Inactive</StatusPill>);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
