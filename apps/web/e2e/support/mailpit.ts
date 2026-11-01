import type { APIRequestContext } from '@playwright/test';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const POLL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;

interface MailpitSearch {
  messages?: { ID: string; Subject: string }[];
}

interface MailpitMessage {
  Subject: string;
  Text: string;
}

/** The ids of the messages to `address` right now, to tell new mail from old. */
export async function mailIds(request: APIRequestContext, address: string): Promise<Set<string>> {
  const query = encodeURIComponent(`to:"${address}"`);
  const search = await request.get(`${MAILPIT_URL}/api/v1/search?query=${query}`);
  const { messages } = search.ok() ? ((await search.json()) as MailpitSearch) : { messages: [] };
  return new Set((messages ?? []).map((m) => m.ID));
}

/**
 * Polls Mailpit for the newest message to `address` (whose subject matches `subject`, when given),
 * then returns its subject and text part.
 */
export async function latestEmailTo(
  request: APIRequestContext,
  address: string,
  subject?: RegExp,
  /** Also required: the text part matches (tells apart several messages to one address). */
  text?: RegExp,
  /** Messages (by `mailIds`) that were already there and must not count. */
  except: ReadonlySet<string> = new Set(),
): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const query = encodeURIComponent(`to:"${address}"`);
  for (;;) {
    const search = await request.get(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    if (search.ok()) {
      const { messages } = (await search.json()) as MailpitSearch;
      for (const match of messages ?? []) {
        if (except.has(match.ID) || (subject && !subject.test(match.Subject))) continue;
        const message = await request.get(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
        const body = (await message.json()) as MailpitMessage;
        if (text && !text.test(body.Text)) continue;
        return { subject: body.Subject, text: body.Text };
      }
    }
    if (Date.now() > deadline) throw new Error(`No matching email to ${address} within 10 s`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** The single-use verification link (absolute URL) found in the email's text part. */
export function verificationLink(text: string): string {
  const match = /https?:\/\/\S+token=[^\s<>"]+/.exec(text);
  if (!match) throw new Error(`No verification link in email:\n${text}`);
  return match[0];
}
