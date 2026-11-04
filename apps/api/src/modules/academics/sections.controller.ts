import {
  type ClassTeacherOptionsResponse,
  classTeacherOptionsResponseSchema,
  copySectionsRequestSchema,
  type CopySectionsResponse,
  copySectionsResponseSchema,
  createSectionRequestSchema,
  type Section,
  sectionSchema,
  type SectionsResponse,
  sectionsResponseSchema,
  updateSectionRequestSchema,
} from '@classloom/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
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
import { SectionsService } from './sections.service';

class SectionDto extends withNullableProperties(createZodDto(sectionSchema)) {}
class SectionsResponseDto extends withNullableProperties(createZodDto(sectionsResponseSchema)) {}
class CopySectionsResponseDto extends withNullableProperties(
  createZodDto(copySectionsResponseSchema),
) {}
class ClassTeacherOptionsResponseDto extends withNullableProperties(
  createZodDto(classTeacherOptionsResponseSchema),
) {}
class CreateSectionRequestDto extends createZodDto(createSectionRequestSchema) {}
class UpdateSectionRequestDto extends createZodDto(updateSectionRequestSchema.strict()) {}
class CopySectionsRequestDto extends createZodDto(copySectionsRequestSchema) {}
class ListSectionsQueryDto extends createZodDto(
  z.object({ yearId: z.uuid(), campusId: z.uuid() }),
) {}
class ClassTeacherOptionsQueryDto extends createZodDto(z.object({ yearId: z.uuid() })) {}

const NOT_FOUND = 'No such section in this school';
const NO_SESSION = 'No valid session';
const NEEDS_VIEW = 'Needs classes.view (type permission-denied)';
const NEEDS_MANAGE = 'Needs classes.manage (type permission-denied)';
const LOCKED = 'academic-year-locked: the year is CLOSED';
const RULES =
  'classes-not-set, class-out-of-range, stream-required, stream-not-allowed, ' +
  'room-campus-mismatch, room-archived, teacher-unavailable, or an unknown stream or room';

@ApiTags('academics')
@ApiCookieAuth()
@Controller('academics')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  @Get('sections')
  @RequirePermission('classes.view')
  @ApiOperation({
    operationId: 'listSections',
    summary: 'Sections of a year and campus, by class level, then name',
  })
  @ApiOkResponse({ type: SectionsResponseDto })
  @ApiBadRequestResponse({ description: 'yearId and campusId must be UUIDs' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_VIEW })
  @ApiNotFoundResponse({ description: 'No such academic year or campus in this school' })
  list(
    @CurrentAuth() auth: RequestAuth,
    @Query() query: ListSectionsQueryDto,
  ): Promise<SectionsResponse> {
    return this.sections.list(auth, query.yearId, query.campusId);
  }

  @Post('sections')
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'createSection', summary: 'Add a section to a year and campus' })
  @ApiCreatedResponse({ type: SectionDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: 'No such academic year or campus in this school' })
  @ApiConflictResponse({
    description: `name-taken (field name), teacher-taken (sectionName), academics-limit, ${LOCKED}`,
  })
  @ApiUnprocessableEntityResponse({ description: RULES })
  create(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CreateSectionRequestDto,
    @Req() req: Request,
  ): Promise<Section> {
    return this.sections.create(auth, body, auditMeta(req));
  }

  @Post('sections/copy-from-previous')
  @RequirePermission('classes.manage')
  @ApiOperation({
    operationId: 'copySectionsFromPrevious',
    summary: "Copy the previous year's sections on a campus into this year",
  })
  @ApiCreatedResponse({ type: CopySectionsResponseDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: 'No such academic year or campus in this school' })
  @ApiConflictResponse({
    description: `sections-exist, nothing-to-copy, classes-not-set, academics-limit, ${LOCKED}`,
  })
  copy(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CopySectionsRequestDto,
    @Req() req: Request,
  ): Promise<CopySectionsResponse> {
    return this.sections.copyFromPrevious(auth, body, auditMeta(req));
  }

  @Patch('sections/:id')
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'updateSection', summary: 'Edit a section' })
  @ApiOkResponse({ type: SectionDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({
    description: `name-taken (field name), teacher-taken (sectionName), ${LOCKED}`,
  })
  @ApiUnprocessableEntityResponse({ description: RULES })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Body() body: UpdateSectionRequestDto,
    @Req() req: Request,
  ): Promise<Section> {
    return this.sections.update(auth, id, body, auditMeta(req));
  }

  @Delete('sections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'deleteSection', summary: 'Delete a section' })
  @ApiNoContentResponse({ description: 'The section was deleted.' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: LOCKED })
  async remove(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.sections.remove(auth, id, auditMeta(req));
  }

  @Get('class-teacher-options')
  @RequirePermission('classes.view')
  @ApiOperation({
    operationId: 'listClassTeacherOptions',
    summary: 'Active members, with the section each already leads in the year',
  })
  @ApiOkResponse({ type: ClassTeacherOptionsResponseDto })
  @ApiBadRequestResponse({ description: 'yearId must be a UUID' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_VIEW })
  @ApiNotFoundResponse({ description: 'No such academic year in this school' })
  classTeacherOptions(
    @CurrentAuth() auth: RequestAuth,
    @Query() query: ClassTeacherOptionsQueryDto,
  ): Promise<ClassTeacherOptionsResponse> {
    return this.sections.classTeacherOptions(auth, query.yearId);
  }
}
