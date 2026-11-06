import {
  CLASS_LEVELS,
  type ClassSubjectsClass,
  classSubjectsClassSchema,
  type ClassSubjectsResponse,
  classSubjectsResponseSchema,
  replaceClassSubjectsRequestSchema,
} from '@classloom/contracts';
import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { withNullableProperties } from '../../core/http/nullable-openapi';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { RequirePermission } from '../iam/require-permission.decorator';
import { auditMeta } from './academics-write';
import { ClassSubjectsService } from './class-subjects.service';

class ClassSubjectsResponseDto extends withNullableProperties(
  createZodDto(classSubjectsResponseSchema),
) {}
class ClassSubjectsClassDto extends withNullableProperties(
  createZodDto(classSubjectsClassSchema),
) {}
class ReplaceClassSubjectsRequestDto extends withNullableProperties(
  createZodDto(replaceClassSubjectsRequestSchema),
) {}
class ClassLevelParamDto extends createZodDto(z.object({ classLevel: z.enum(CLASS_LEVELS) })) {}

const NO_SESSION = 'No valid session';

@ApiTags('academics')
@ApiCookieAuth()
@Controller('academics/class-subjects')
export class ClassSubjectsController {
  constructor(private readonly classSubjects: ClassSubjectsService) {}

  @Get()
  @RequirePermission('subjects.view')
  @ApiOperation({
    operationId: 'listClassSubjects',
    summary:
      'Every class subject, grouped by class level: every class in the profile range, plus any outside it that still has rows (outsideRange)',
  })
  @ApiOkResponse({ type: ClassSubjectsResponseDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: 'Needs subjects.view (type permission-denied)' })
  list(@CurrentAuth() auth: RequestAuth): Promise<ClassSubjectsResponse> {
    return this.classSubjects.list(auth);
  }

  @Put(':classLevel')
  @RequirePermission('subjects.manage')
  @ApiOperation({
    operationId: 'replaceClassSubjects',
    summary: "Replace one class's subjects; streams only for XI and XII",
  })
  @ApiOkResponse({ type: ClassSubjectsClassDto })
  @ApiBadRequestResponse({ description: 'The class level or a row is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: 'Needs subjects.manage (type permission-denied)' })
  @ApiConflictResponse({ description: 'classes-not-set' })
  @ApiUnprocessableEntityResponse({
    description:
      'class-out-of-range, stream-not-allowed (a stream on a junior class), subject-archived or stream-archived (newly added), or a row naming an unknown subject or stream, repeating one, or one deleted meanwhile',
  })
  replace(
    @CurrentAuth() auth: RequestAuth,
    @Param() params: ClassLevelParamDto,
    @Body() body: ReplaceClassSubjectsRequestDto,
    @Req() req: Request,
  ): Promise<ClassSubjectsClass> {
    return this.classSubjects.replace(auth, params.classLevel, body.rows, auditMeta(req));
  }
}
