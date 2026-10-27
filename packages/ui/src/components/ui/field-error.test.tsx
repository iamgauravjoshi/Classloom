import { render, screen } from '@testing-library/react';

import { Alert, AlertDescription } from './alert';
import { Field, FieldError } from './field';

// text-destructive on the dark card is ~3.8:1; text uses the AA-checked danger-strong token.
describe('error text colours', () => {
  it('FieldError uses text-danger-strong', () => {
    render(<FieldError>Enter a valid email address.</FieldError>);
    const error = screen.getByRole('alert');
    expect(error).toHaveClass('text-danger-strong');
    expect(error.className).not.toMatch(/text-destructive\b/);
  });

  it('an invalid Field tints its text with danger-strong', () => {
    render(<Field data-invalid="true">x</Field>);
    const field = screen.getByRole('group');
    expect(field.className).toContain('data-[invalid=true]:text-danger-strong');
    expect(field.className).not.toMatch(/text-destructive\b/);
  });

  it('destructive Alert uses text-danger-strong', () => {
    render(
      <Alert variant="destructive">
        <AlertDescription>Failed</AlertDescription>
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('text-danger-strong');
    expect(alert.className).not.toMatch(/text-destructive\b/);
  });
});
