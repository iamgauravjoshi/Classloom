import { Button } from '@classloom/ui/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@classloom/ui/components/ui/input-otp';
import { Label } from '@classloom/ui/components/ui/label';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconSchool } from '@tabler/icons-react';
import { useState } from 'react';

import { AuthCard } from '../components/auth-card';
import { PasswordInput } from '../components/password-input';
import { PasswordRules } from '../components/password-rules';

const meta: Meta = { title: 'Auth' };
export default meta;

function Otp({ initial = '', invalid = false }: { initial?: string; invalid?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <InputOTP
      maxLength={6}
      value={value}
      onChange={setValue}
      aria-label="Sign-in code"
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? 'otp-error' : undefined}
    >
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

export const OtpEmpty: StoryObj = { render: () => <Otp /> };
export const OtpFilled: StoryObj = { render: () => <Otp initial="482913" /> };
export const OtpError: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Otp initial="482913" invalid />
      <p id="otp-error" className="text-danger-strong text-sm" role="alert">
        That code is wrong or has expired.
      </p>
    </div>
  ),
};

function Password({ initial = '', shown = false }: { initial?: string; shown?: boolean }) {
  return (
    <div className="flex max-w-sm flex-col gap-1.5">
      <Label htmlFor={`pw-${String(shown)}`}>Password</Label>
      <PasswordInput
        id={`pw-${String(shown)}`}
        defaultValue={initial}
        showLabel="Show password"
        hideLabel="Hide password"
        autoComplete="current-password"
      />
      {shown && <p className="text-muted-foreground text-sm">Click the eye to hide it again.</p>}
    </div>
  );
}

export const PasswordHidden: StoryObj = { render: () => <Password initial="hunter2-pass" /> };
export const PasswordShown: StoryObj = {
  render: () => <Password initial="hunter2-pass" shown />,
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('button[aria-pressed]')?.click();
  },
};

const ruleLabels = ['At least 8 characters', 'Not a common password'];
const rulesProps = { metLabel: 'met', unmetLabel: 'not met' };

export const RulesNoneMet: StoryObj = {
  render: () => (
    <PasswordRules {...rulesProps} rules={ruleLabels.map((label) => ({ label, met: false }))} />
  ),
};
export const RulesSomeMet: StoryObj = {
  render: () => (
    <PasswordRules
      {...rulesProps}
      rules={ruleLabels.map((label, index) => ({ label, met: index === 0 }))}
    />
  ),
};
export const RulesAllMet: StoryObj = {
  render: () => (
    <PasswordRules {...rulesProps} rules={ruleLabels.map((label) => ({ label, met: true }))} />
  ),
};

function CardExample() {
  return (
    <AuthCard
      title="Sign in"
      description="Enter your details to continue"
      logo={
        <span className="flex items-center gap-2 text-xl font-semibold">
          <IconSchool size={28} aria-hidden="true" />
          Classloom
        </span>
      }
      footer={<a href="#">Forgot password?</a>}
      copyright="© Classloom"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="card-pw">Password</Label>
          <PasswordInput
            id="card-pw"
            autoComplete="current-password"
            showLabel="Show password"
            hideLabel="Hide password"
          />
        </div>
        <Button className="w-full">Sign in</Button>
      </div>
    </AuthCard>
  );
}

export const CardLight: StoryObj = {
  parameters: { layout: 'fullscreen' },
  render: () => <CardExample />,
};
export const CardDark: StoryObj = {
  parameters: { layout: 'fullscreen' },
  // The tokens key on an ancestor `.dark` class, so wrap the story in one.
  render: () => (
    <div className="dark bg-background text-foreground" data-testid="dark-wrapper">
      <CardExample />
    </div>
  ),
};
