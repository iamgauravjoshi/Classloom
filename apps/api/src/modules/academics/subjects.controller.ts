import {
  createSubjectRequestSchema,
  type StarterSubjectsAddedResponse,
  starterSubjectsAddedResponseSchema,
  starterSubjectsRequestSchema,
  type StarterSubjectsResponse,
  starterSubjectsResponseSchema,
  type Subject,
  subjectSchema,
  type SubjectsResponse,
  subjectsResponseSchema,
  updateSubjectRequestSchema,
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
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';

import { withNullableProperties } from '../../core/http/nullable-openapi';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { RequirePermission } from '../iam/require-permission.decorator';
import { auditMeta } from './academics-write';
import { SubjectsService } from './subjects.service';

class SubjectDto extends withNullableProperties(createZodDto(subjectSchema)) {}
class SubjectsResponseDto extends withNullableProperties(createZodDto(subjectsResponseSchema)) {}
class StarterSubjectsResponseDto extends withNullableProperties(
  createZodDto(starterSubjectsResponseSchema),
) {}
class StarterSubjectsRequestDto extends withNullableProperties(
  createZodDto(starterSubjectsRequestSchema),
) {}
class StarterSubjectsAddedResponseDto extends withNullableProperties(
  createZodDto(starterSubjectsAddedResponseSchema),
) {}
class CreateSubjectRequestDto extends withNullableProperties(
  createZodDto(createSubjectRequestSchema),
) {}
/** Status changes only through archive and restore: a `status` here is a 400. */
class UpdateSubjectRequestDto extends withNullableProperties(
  createZodDto(updateSubjectRequestSchema.strict()),
) {}

const NOT_FOUND = 'No such subject in this school';
const NO_SESSION = 'No valid session';
const NEEDS_VIEW = 'Needs subjects.view (type permission-denied)';
const NEEDS_MANAGE = 'Needs subjects.manage (type permission-denied)';

@ApiTags('academics')
@ApiCookieAuth()
@Controller('academics/subjects')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get()
  @RequirePermission('subjects.view')
  @ApiOperation({
    operationId: 'listSubjects',
    summary: 'All subjects, active first, then by name',
  })
  @ApiOkResponse({ type: SubjectsResponseDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_VIEW })
  list(@CurrentAuth() auth: RequestAuth): Promise<SubjectsResponse> {
    return this.subjects.list(auth);
  }

  @Get('starter')
  @RequirePermission('subjects.view')
  @ApiOperation({
    operationId: 'getStarterSubjects',
    summary: "The school's board starter list, with exists for names the school already has",
  })
  @ApiOkResponse({ type: StarterSubjectsResponseDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_VIEW })
  starter(@CurrentAuth() auth: RequestAuth): Promise<StarterSubjectsResponse> {
    return this.subjects.starter(auth);
  }

  @Post('starter')
  @RequirePermission('subjects.manage')
  @ApiOperation({
    operationId: 'addStarterSubjects',
    summary: 'Add the picked starter subjects, skipping names the school already has',
  })
  @ApiCreatedResponse({ type: StarterSubjectsAddedResponseDto })
  @ApiBadRequestResponse({ description: 'An item is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiConflictResponse({ description: 'academics-limit' })
  addStarter(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: StarterSubjectsRequestDto,
    @Req() req: Request,
  ): Promise<StarterSubjectsAddedResponse> {
    return this.subjects.addStarter(auth, body, auditMeta(req));
  }

  @Post()
  @RequirePermission('subjects.manage')
  @ApiOperation({ operationId: 'createSubject', summary: 'Add a subject; at most 200 per school' })
  @ApiCreatedResponse({ type: SubjectDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiConflictResponse({ description: 'name-taken (field name) or academics-limit' })
  create(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CreateSubjectRequestDto,
    @Req() req: Request,
  ): Promise<Subject> {
    return this.subjects.create(auth, body, auditMeta(req));
  }

  @Patch(':id')
  @RequirePermission('subjects.manage')
  @ApiOperation({
    operationId: 'updateSubject',
    summary: 'Edit a subject; fields left out are kept, "" or null clears the code',
  })
  @ApiOkResponse({ type: SubjectDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'name-taken (field name)' })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Body() body: UpdateSubjectRequestDto,
    @Req() req: Request,
  ): Promise<Subject> {
    return this.subjects.update(auth, id, body, auditMeta(req));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('subjects.manage')
  @ApiOperation({
    operationId: 'archiveSubject',
    summary: 'Archive a subject; classes keep it, but it cannot be newly added',
  })
  @ApiOkResponse({ type: SubjectDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  archive(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Subject> {
    return this.subjects.setStatus(auth, id, 'ARCHIVED', auditMeta(req));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('subjects.manage')
  @ApiOperation({ operationId: 'restoreSubject', summary: 'Restore an archived subject' })
  @ApiOkResponse({ type: SubjectDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  restore(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Subject> {
    return this.subjects.setStatus(auth, id, 'ACTIVE', auditMeta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('subjects.manage')
  @ApiOperation({ operationId: 'deleteSubject', summary: 'Delete a subject no class uses' })
  @ApiNoContentResponse({ description: 'The subject was deleted.' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'in-use, with counts { classSubjects }' })
  async remove(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.subjects.remove(auth, id, auditMeta(req));
  }
}
