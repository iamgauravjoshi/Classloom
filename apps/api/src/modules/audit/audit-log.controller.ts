import {
  type AuditEventsPage,
  auditEventsPageSchema,
  auditEventsQuerySchema,
} from '@classloom/contracts';
import { Controller, Get, Query, Req, Res, StreamableFile } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';

import { withNullableProperties } from '../../core/http/nullable-openapi';
import { auditMeta } from '../academics/academics-write';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { RequirePermission } from '../iam/require-permission.decorator';
import { AuditLogService } from './audit-log.service';

class AuditEventsPageDto extends withNullableProperties(createZodDto(auditEventsPageSchema)) {}
class ListAuditEventsQueryDto extends createZodDto(auditEventsQuerySchema) {}
class ExportAuditEventsQueryDto extends createZodDto(
  auditEventsQuerySchema.omit({ cursor: true, limit: true }),
) {}

const NO_SESSION = 'No valid session';
const BAD_FILTER = 'A date is not a real YYYY-MM-DD date, or a filter or the cursor is not valid';
const FORBIDDEN = 'Needs audit.view (type permission-denied)';

@ApiTags('audit')
@ApiCookieAuth()
@Controller('audit')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get('events')
  @RequirePermission('audit.view')
  @ApiOperation({
    operationId: 'listAuditEvents',
    summary:
      "The school's audit trail, newest first; from and to are inclusive IST dates, limit 50 by default (at most 100)",
  })
  @ApiOkResponse({ type: AuditEventsPageDto })
  @ApiBadRequestResponse({ description: BAD_FILTER })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  list(
    @CurrentAuth() auth: RequestAuth,
    @Query() query: ListAuditEventsQueryDto,
  ): Promise<AuditEventsPage> {
    return this.auditLog.list(auth, query);
  }

  @Get('events.csv')
  @RequirePermission('audit.view')
  @ApiOperation({
    operationId: 'exportAuditEvents',
    summary: 'The filtered audit trail as CSV (up to 5,000 events); each export is itself audited',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The CSV, as an attachment named audit-log-<from>-<to>.csv',
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiBadRequestResponse({ description: BAD_FILTER })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiUnprocessableEntityResponse({
    description: 'export-too-large (with limit): more than 5,000 events match; narrow the filter',
  })
  async export(
    @CurrentAuth() auth: RequestAuth,
    @Query() query: ExportAuditEventsQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { filename, csv } = await this.auditLog.export(auth, query, auditMeta(req));
    // Personal data: never kept by a browser or proxy cache.
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
