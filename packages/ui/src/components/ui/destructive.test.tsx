import { render, screen } from '@testing-library/react';

import { Badge } from './badge';
import { Button } from './button';

// shadcn's stock destructive variants use text-destructive on bg-destructive/10 (3.3–3.9:1);
// Classloom maps them onto the AA-checked danger tint/strong pair instead.
describe('destructive variants', () => {
  it('Button uses the AA-safe danger pair', () => {
    render(<Button variant="destructive">Delete student</Button>);
    const button = screen.getByRole('button', { name: 'Delete student' });
    expect(button).toHaveClass('bg-danger-tint', 'text-danger-strong');
    expect(button.className).not.toMatch(/text-destructive\b/);
  });

  it('Badge uses the AA-safe danger pair', () => {
    render(<Badge variant="destructive">Overdue</Badge>);
    const badge = screen.getByText('Overdue');
    expect(badge).toHaveClass('bg-danger-tint', 'text-danger-strong');
  });
});
