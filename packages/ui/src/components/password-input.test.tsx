import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PasswordInput } from './password-input';

describe('PasswordInput', () => {
  it('toggles the field between password and text and flips aria-pressed', async () => {
    const user = userEvent.setup();
    render(
      <PasswordInput aria-label="Password" showLabel="Show password" hideLabel="Hide password" />,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);

    expect(input).toHaveAttribute('type', 'text');
    const pressed = screen.getByRole('button', { name: 'Hide password' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not submit a form when the toggle is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="Password" showLabel="Show" hideLabel="Hide" />
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('passes input props through', () => {
    render(
      <PasswordInput
        aria-label="Password"
        showLabel="Show"
        hideLabel="Hide"
        autoComplete="current-password"
        aria-invalid
      />,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
