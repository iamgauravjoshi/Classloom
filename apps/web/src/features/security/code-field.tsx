'use client';

import { Field, FieldError, FieldLabel } from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@classloom/ui/components/ui/input-otp';
import { cn } from '@classloom/ui/lib/utils';

import { CONTROL_CLASS } from '../auth/auth-ui';

export const CODE_LENGTH = 6;

interface CodeFieldProps {
  id: string;
  label: string;
  value: string;
  error: string | null;
  /** A recovery code (`XXXXX-XXXXX`, free text) instead of the 6 app-code slots. */
  recovery?: boolean;
  onChange: (value: string) => void;
  /** The 6th digit was typed: the caller submits. */
  onComplete?: (value: string) => void;
}

/** The app-code slots (or a recovery-code box) with its label and error, for the dialogs. */
export function CodeField({
  id,
  label,
  value,
  error,
  recovery = false,
  onChange,
  onComplete,
}: CodeFieldProps) {
  const describedBy = error ? `${id}-error` : undefined;
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {recovery ? (
        <Input
          id={id}
          name="recovery-code"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          placeholder="XXXXX-XXXXX"
          className={cn(CONTROL_CLASS, 'font-mono')}
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <InputOTP
          id={id}
          name="code"
          maxLength={CODE_LENGTH}
          value={value}
          autoFocus
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={onChange}
          onComplete={(complete: string) => onComplete?.(complete)}
        >
          <InputOTPGroup>
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <InputOTPSlot key={index} index={index} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      )}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
