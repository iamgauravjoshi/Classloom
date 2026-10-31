'use client';

import { Button } from '@classloom/ui/components/ui/button';
import { Input } from '@classloom/ui/components/ui/input';
import { cn } from '@classloom/ui/lib/utils';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import * as React from 'react';

export interface PasswordInputProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  /** Accessible name of the toggle while the password is hidden, e.g. "Show password". */
  showLabel: string;
  /** Accessible name of the toggle while the password is shown, e.g. "Hide password". */
  hideLabel: string;
}

/** Password field with a show/hide toggle (44 px touch target on coarse pointers). */
export function PasswordInput({ showLabel, hideLabel, className, ...props }: PasswordInputProps) {
  const [shown, setShown] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        className={cn('pr-10 pointer-coarse:h-11 pointer-coarse:pr-12', className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-pressed={shown}
        aria-label={shown ? hideLabel : showLabel}
        onClick={() => setShown((value) => !value)}
        className="text-muted-foreground absolute top-1/2 right-0.5 -translate-y-1/2 pointer-coarse:size-11"
      >
        {shown ? <IconEyeOff aria-hidden="true" /> : <IconEye aria-hidden="true" />}
      </Button>
    </div>
  );
}
