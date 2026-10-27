import type { APIRequestContext } from '@playwright/test';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const POLL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;

interface MailpitSearch {
  messages?: { ID: string }[];
}

interface MailpitMessage {
  Subject: string;
  Text: string;
}

/** Polls Mailpit for the newest message to `address`, then returns its subject and text part. */
export async function latestEmailTo(
  request: APIRequestContext,
  address: string,
): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const query = encodeURIComponent(`to:"${address}"`);
  for (;;) {
    const search = await request.get(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    if (search.ok()) {
      const { messages } = (await search.json()) as MailpitSearch;
      const id = messages?.[0]?.ID;
      if (id) {
        const message = await request.get(`${MAILPIT_URL}/api/v1/message/${id}`);
        const body = (await message.json()) as MailpitMessage;
        return { subject: body.Subject, text: body.Text };
      }
    }
    if (Date.now() > deadline) throw new Error(`No email to ${address} within 10 s`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** The single-use verification link (absolute URL) found in the email's text part. */
export function verificationLink(text: string): string {
  const match = /https?:\/\/\S+token=[^\s<>"]+/.exec(text);
  if (!match) throw new Error(`No verification link in email:\n${text}`);
  return match[0];
}
