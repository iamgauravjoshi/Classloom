import {
  type NumberSeries,
  type NumberSeriesList,
  numberSeriesListSchema,
  numberSeriesSchema,
  updateNumberSeriesRequestSchema,
} from '@classloom/contracts';
import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';

import { withNullableProperties } from '../../core/http/nullable-openapi';
import { auditMeta } from '../academics/academics-write';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { RequirePermission } from '../iam/require-permission.decorator';
import { NumberSeriesService } from './number-series.service';

class NumberSeriesDto extends withNullableProperties(createZodDto(numberSeriesSchema)) {}
class NumberSeriesListDto extends withNullableProperties(createZodDto(numberSeriesListSchema)) {}
class UpdateNumberSeriesRequestDto extends createZodDto(updateNumberSeriesRequestSchema.strict()) {}

const NO_SESSION = 'No valid session';

@ApiTags('settings')
@ApiCookieAuth()
@Controller('settings/number-series')
export class NumberSeriesController {
  constructor(private readonly series: NumberSeriesService) {}

  @Get()
  @RequirePermission('settings.view')
  @ApiOperation({
    operationId: 'listNumberSeries',
    summary: 'The four number series, each with its next number and a preview for the current year',
  })
  @ApiOkResponse({ type: NumberSeriesListDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: 'Needs settings.view (type permission-denied)' })
  list(@CurrentAuth() auth: RequestAuth): Promise<NumberSeriesList> {
    return this.series.list(auth);
  }

  @Patch(':key')
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'updateNumberSeries',
    summary: "Change a series' pattern, reset rule or next number",
  })
  @ApiOkResponse({ type: NumberSeriesDto })
  @ApiBadRequestResponse({ description: 'A field is not valid, or no field was sent' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: 'No such number series' })
  @ApiConflictResponse({ description: 'no-current-year (a per-year next number without a year)' })
  @ApiUnprocessableEntityResponse({
    description: 'number-pattern-invalid (with problem) or next-number-too-low (with minimum)',
  })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('key') key: string,
    @Body() body: UpdateNumberSeriesRequestDto,
    @Req() req: Request,
  ): Promise<NumberSeries> {
    return this.series.update(auth, key, body, auditMeta(req));
  }
}
