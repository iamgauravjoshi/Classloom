import type { INestApplication } from '@nestjs/common';

import { EmailService } from '../src/core/email/email.service';
import { createApp } from '../src/main';
import { startTestInfra, type TestInfra } from './setup-containers';

interface MailpitMessage {
  Subject: string;
  To: { Address: string }[];
}

describe('queued email', () => {
  let infra: TestInfra;
  let app: INestApplication;

  beforeAll(async () => {
    infra = await startTestInfra({ mailpit: true });
    app = await createApp(infra.env, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('delivers an enqueued message through SMTP', async () => {
    await app.get(EmailService).enqueue({
      to: 'principal@gisd.example',
      subject: 'Verify your school registration on Classloom',
      html: '<p>hello</p>',
      text: 'hello',
    });

    const deadline = Date.now() + 10_000;
    let messages: MailpitMessage[] = [];
    while (Date.now() < deadline) {
      const res = await fetch(`${infra.mailpitApiUrl}/api/v1/messages`);
      messages = ((await res.json()) as { messages: MailpitMessage[] }).messages;
      if (messages.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]?.To[0]?.Address).toBe('principal@gisd.example');
    expect(messages[0]?.Subject).toBe('Verify your school registration on Classloom');
  });
});
