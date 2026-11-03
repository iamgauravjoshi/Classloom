import {
  type SchoolProfile,
  schoolProfileSchema,
  updateSchoolProfileRequestSchema,
} from '@classloom/contracts';
import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
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
import { ProfileService } from './profile.service';

class SchoolProfileDto extends withNullableProperties(createZodDto(schoolProfileSchema)) {}
class UpdateSchoolProfileRequestDto extends createZodDto(updateSchoolProfileRequestSchema) {}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@ApiTags('school')
@ApiCookieAuth()
@Controller('school/profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  /** Members see the school's name and logo in the shell, so any member may read it. */
  @Get()
  @ApiOperation({
    operationId: 'getSchoolProfile',
    summary: "The school's profile with its name, board, code and versioned logo URL",
  })
  @ApiOkResponse({ type: SchoolProfileDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  get(@CurrentAuth() auth: RequestAuth): Promise<SchoolProfile> {
    return this.profiles.get(auth);
  }

  @Put()
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'updateSchoolProfile',
    summary: 'Replace the editable profile fields; empty strings become null',
  })
  @ApiOkResponse({ type: SchoolProfileDto })
  @ApiBadRequestResponse({ description: 'A field is not valid (errors[] by path)' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: UpdateSchoolProfileRequestDto,
    @Req() req: Request,
  ): Promise<SchoolProfile> {
    return this.profiles.update(auth, body, meta(req));
  }
}
