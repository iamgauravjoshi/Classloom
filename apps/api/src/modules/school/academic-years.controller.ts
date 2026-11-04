import {
  type AcademicYear,
  academicYearSchema,
  type AcademicYearsResponse,
  academicYearsResponseSchema,
  createAcademicYearRequestSchema,
  updateAcademicYearRequestSchema,
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
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';

import { withNullableProperties } from '../../core/http/nullable-openapi';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { RequirePermission } from '../iam/require-permission.decorator';
import { AcademicYearsService } from './academic-years.service';

class AcademicYearDto extends withNullableProperties(createZodDto(academicYearSchema)) {}
class AcademicYearsResponseDto extends withNullableProperties(
  createZodDto(academicYearsResponseSchema),
) {}
class CreateAcademicYearRequestDto extends withNullableProperties(
  createZodDto(createAcademicYearRequestSchema),
) {}
class UpdateAcademicYearRequestDto extends withNullableProperties(
  createZodDto(updateAcademicYearRequestSchema),
) {}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

const TERMS_INVALID = "The terms don't tile the year (type academic-terms-invalid, errors[] path)";

@ApiTags('school')
@ApiCookieAuth()
@Controller('school/academic-years')
export class AcademicYearsController {
  constructor(private readonly years: AcademicYearsService) {}

  /** The year switcher shows every member the school's years, so any member may read them. */
  @Get()
  @ApiOperation({
    operationId: 'listAcademicYears',
    summary: "The school's academic years, newest first, with their terms",
  })
  @ApiOkResponse({ type: AcademicYearsResponseDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  list(@CurrentAuth() auth: RequestAuth): Promise<AcademicYearsResponse> {
    return this.years.list(auth);
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'createAcademicYear',
    summary:
      'Create a year with its terms (or termCount default terms): CURRENT if the school has none, else PLANNED',
  })
  @ApiCreatedResponse({ type: AcademicYearDto })
  @ApiBadRequestResponse({ description: 'A field is not valid, or the year is not 180-400 days' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiConflictResponse({
    description: 'academic-year-overlap, academic-year-planned-exists or academic-year-label-taken',
  })
  @ApiUnprocessableEntityResponse({ description: TERMS_INVALID })
  create(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CreateAcademicYearRequestDto,
    @Req() req: Request,
  ): Promise<AcademicYear> {
    return this.years.create(auth, body, meta(req));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'updateAcademicYear',
    summary: 'Change the label, the dates and the terms (sent in full); refused for a closed year',
  })
  @ApiOkResponse({ type: AcademicYearDto })
  @ApiBadRequestResponse({ description: 'A field is not valid, or the year is not 180-400 days' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: 'No such year in this school' })
  @ApiConflictResponse({
    description: 'academic-year-locked, academic-year-overlap or academic-year-label-taken',
  })
  @ApiUnprocessableEntityResponse({ description: TERMS_INVALID })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Body() body: UpdateAcademicYearRequestDto,
    @Req() req: Request,
  ): Promise<AcademicYear> {
    return this.years.update(auth, id, body, meta(req));
  }

  @Post(':id/make-current')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'makeAcademicYearCurrent',
    summary: 'Make the planned year current; the previous current year is closed',
  })
  @ApiOkResponse({ type: AcademicYearDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: 'No such year in this school' })
  @ApiConflictResponse({ description: 'The year is not planned (type academic-year-locked)' })
  makeCurrent(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<AcademicYear> {
    return this.years.makeCurrent(auth, id, meta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteAcademicYear', summary: 'Delete the planned year' })
  @ApiNoContentResponse({ description: 'The year and its terms were deleted.' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: 'No such year in this school' })
  @ApiConflictResponse({ description: 'The year is not planned (type academic-year-locked)' })
  async remove(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.years.remove(auth, id, meta(req));
  }
}
