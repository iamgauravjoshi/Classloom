import { Module } from '@nestjs/common';

import { IamModule } from '../iam/iam.module';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

/** The audit-log viewer (Part 6a spec section 5): read and export the school's audit trail. */
@Module({
  imports: [IamModule],
  controllers: [AuditLogController],
  providers: [AuditLogService],
})
export class AuditLogModule {}
