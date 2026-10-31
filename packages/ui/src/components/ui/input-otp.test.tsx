import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InputOTP, InputOTPGroup, InputOTPSlot } from './input-otp';

function Otp({ onComplete }: { onComplete?: (v: string) => void }) {
  return (
    <InputOTP maxLength={6} aria-label="Code" onComplete={onComplete}>
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

describe('InputOTP', () => {
  it('is one numeric one-time-code input', () => {
    render(<Otp />);
    const input = screen.getByLabelText('Code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('pattern', '^[0-9]*$');
  });

  it('accepts digits only and completes on the sixth', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Otp onComplete={onComplete} />);
    await user.type(screen.getByLabelText('Code'), '12a345');
    expect(onComplete).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Code'), '6');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});

describe('InputOTP accessibility props', () => {
  it('passes aria-invalid and aria-describedby to the real input', () => {
    render(
      <InputOTP maxLength={6} aria-label="Code" aria-invalid aria-describedby="err">
        <InputOTPGroup>
          <InputOTPSlot index={0} />
        </InputOTPGroup>
      </InputOTP>,
    );
    const input = screen.getByLabelText('Code');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'err');
  });
});

describe('caret blink animation', () => {
  it('is defined in the ui CSS and respects reduced motion', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
    expect(css).toContain('@keyframes caret-blink');
    expect(css).toContain('--animate-caret-blink');
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)[\s\S]*animate-caret-blink[\s\S]*animation: none/,
    );
  });
});
