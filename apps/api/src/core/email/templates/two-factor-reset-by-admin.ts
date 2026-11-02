import messages from '../../../../messages/en.json';
import type { EmailMessage } from '../email-sender';
import { fill, istMoment, renderNotice } from './notice-layout';

const copy = messages.email.twoFactorResetByAdmin;

export interface TwoFactorResetByAdminInput {
  /** The school whose admin did it. */
  schoolName: string;
  at: Date;
  securityUrl: string;
}

/** Tells a person their school's admin turned off their two-step sign-in. */
export function twoFactorResetByAdminEmail(
  input: TwoFactorResetByAdminInput,
): Omit<EmailMessage, 'to'> {
  return renderNotice({
    subject: copy.subject,
    heading: copy.heading,
    intro: fill(copy.intro, { school: input.schoolName }),
    rows: [
      [copy.schoolLabel, input.schoolName],
      [copy.timeLabel, istMoment(copy.time, input.at)],
    ],
    warning: copy.warning,
    button: copy.button,
    url: input.securityUrl,
  });
}
