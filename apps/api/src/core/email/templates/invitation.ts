import messages from '../../../../messages/en.json';
import type { EmailMessage } from '../email-sender';
import { fill, renderNotice } from './notice-layout';

const copy = messages.email.invitation;

export interface InvitationEmailInput {
  schoolName: string;
  /** The inviting person's name. */
  inviterName: string;
  /** Names of the roles the person will hold. */
  roles: string[];
  /** `${WEB_ORIGIN}/en/join?token=…` */
  joinUrl: string;
  expiresAt: Date;
}

/** "9 Nov 2026", the day in India. */
function dayIN(at: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(at);
}

/** Invites a person to join a school; the link is spent only when they press Join on the page. */
export function invitationEmail(input: InvitationEmailInput): Omit<EmailMessage, 'to'> {
  const school = { school: input.schoolName };
  return renderNotice({
    subject: fill(copy.subject, school),
    heading: fill(copy.heading, school),
    intro: fill(copy.intro, { ...school, inviter: input.inviterName }),
    rows: [
      [copy.schoolLabel, input.schoolName],
      [copy.rolesLabel, input.roles.join(', ')],
    ],
    warning: `${fill(copy.expiry, { date: dayIN(input.expiresAt) })} ${copy.ignore}`,
    button: copy.button,
    url: input.joinUrl,
  });
}
