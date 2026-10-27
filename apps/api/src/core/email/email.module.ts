import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { EmailProcessor } from './email.processor';
import { EMAIL_QUEUE, EmailService } from './email.service';
import { EMAIL_SENDER } from './email-sender';
import { SmtpEmailSender } from './smtp-email-sender';

@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  providers: [{ provide: EMAIL_SENDER, useClass: SmtpEmailSender }, EmailProcessor, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
