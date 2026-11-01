import messages from '../../../../messages/en.json';
import type { EmailMessage } from '../email-sender';
import { istMoment, renderNotice } from './notice-layout';

const copy = messages.email.passwordChanged;

export interface PasswordChangedInput {
  at: Date;
  /** Where the "reset your password now" button goes. */
  forgotUrl: string;
}

export function passwordChangedEmail(input: PasswordChangedInput): Omit<EmailMessage, 'to'> {
  return renderNotice({
    subject: copy.subject,
    heading: copy.heading,
    intro: copy.intro,
    rows: [[copy.timeLabel, istMoment(copy.time, input.at)]],
    warning: copy.warning,
    button: copy.button,
    url: input.forgotUrl,
  });
}
