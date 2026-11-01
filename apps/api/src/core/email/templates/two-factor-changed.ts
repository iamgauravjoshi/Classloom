import messages from '../../../../messages/en.json';
import type { EmailMessage } from '../email-sender';
import { istMoment, renderNotice } from './notice-layout';

const copy = messages.email.twoFactorChanged;

export type TwoFactorChange = 'ENABLED' | 'DISABLED' | 'CODES_REGENERATED';

const BY_CHANGE = {
  ENABLED: copy.enabled,
  DISABLED: copy.disabled,
  CODES_REGENERATED: copy.codesRegenerated,
} satisfies Record<TwoFactorChange, { subject: string; heading: string; intro: string }>;

export interface TwoFactorChangedInput {
  change: TwoFactorChange;
  at: Date;
  securityUrl: string;
}

export function twoFactorChangedEmail(input: TwoFactorChangedInput): Omit<EmailMessage, 'to'> {
  const text = BY_CHANGE[input.change];
  return renderNotice({
    subject: text.subject,
    heading: text.heading,
    intro: text.intro,
    rows: [[copy.timeLabel, istMoment(copy.time, input.at)]],
    warning: copy.warning,
    button: copy.button,
    url: input.securityUrl,
  });
}
