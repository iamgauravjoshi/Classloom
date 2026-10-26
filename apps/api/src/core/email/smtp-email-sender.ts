import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import type { EmailMessage, EmailSender } from './email-sender';

@Injectable()
export class SmtpEmailSender implements EmailSender, OnModuleDestroy {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(@Inject(ENV) env: Env) {
    this.transport = createTransport(env.SMTP_URL);
    this.from = env.EMAIL_FROM;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
