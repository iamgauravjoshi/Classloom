import {
  type Campus,
  type CampusesResponse,
  campusesResponseSchema,
  campusSchema,
  createCampusRequestSchema,
  updateCampusRequestSchema,
} from '@classloom/contracts';
import {
  Body,
  Controller,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { PermissionDeniedException } from '../iam/permission.guard';
import { RequirePermission } from '../iam/require-permission.decorator';
import { CampusesService } from './campuses.service';

class CampusDto extends createZodDto(campusSchema) {}
class CampusesResponseDto extends createZodDto(campusesResponseSchema) {}
class CreateCampusRequestDto extends createZodDto(createCampusRequestSchema) {}
class UpdateCampusRequestDto extends createZodDto(updateCampusRequestSchema) {}
class ListCampusesQueryDto extends createZodDto(
  z.object({ status: z.enum(['active', 'all']).default('active') }),
) {}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

const NOT_FOUND = 'No such campus in this school';

@ApiTags('school')
@ApiCookieAuth()
@Controller('school/campuses')
export class CampusesController {
  constructor(private readonly campuses: CampusesService) {}

  /**
   * The campus switcher shows every member the active campuses, so any member may read them;
   * `?status=all` (the Settings page) also lists inactive ones and needs `settings.view`.
   */
  @Get()
  @ApiOperation({
    operationId: 'listCampuses',
    summary:
      'The active campuses, primary first then by name; ?status=all (needs settings.view) adds inactive ones',
  })
  @ApiOkResponse({ type: CampusesResponseDto })
  @ApiBadRequestResponse({ description: 'status is not active or all' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({
    description: 'status=all needs settings.view (type permission-denied)',
  })
  list(
    @CurrentAuth() auth: RequestAuth,
    @Query() query: ListCampusesQueryDto,
  ): Promise<CampusesResponse> {
    const all = query.status === 'all';
    if (all && !auth.permissions.has('settings.view')) throw new PermissionDeniedException();
    return this.campuses.list(auth, all);
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'createCampus',
    summary: 'Add a campus; at most 20 per school, counting inactive ones',
  })
  @ApiCreatedResponse({ type: CampusDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiConflictResponse({ description: 'campus-name-taken or campus-limit' })
  create(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CreateCampusRequestDto,
    @Req() req: Request,
  ): Promise<Campus> {
    return this.campuses.create(auth, body, meta(req));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'updateCampus',
    summary: 'Edit the name, address and contact; fields left out are kept, "" clears one',
  })
  @ApiOkResponse({ type: CampusDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'campus-name-taken' })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Body() body: UpdateCampusRequestDto,
    @Req() req: Request,
  ): Promise<Campus> {
    return this.campuses.update(auth, id, body, meta(req));
  }

  @Post(':id/make-primary')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'makeCampusPrimary',
    summary: 'Move the primary flag to this campus, which must be active',
  })
  @ApiOkResponse({ type: CampusDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'The campus is inactive (type campus-inactive)' })
  makePrimary(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Campus> {
    return this.campuses.makePrimary(auth, id, meta(req));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('settings.manage')
  @ApiOperation({
    operationId: 'deactivateCampus',
    summary: 'Deactivate a campus; refused for the primary campus and the last active one',
  })
  @ApiOkResponse({ type: CampusDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'campus-primary or campus-last-active' })
  deactivate(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Campus> {
    return this.campuses.deactivate(auth, id, meta(req));
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'reactivateCampus', summary: 'Reactivate an inactive campus' })
  @ApiOkResponse({ type: CampusDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  reactivate(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Campus> {
    return this.campuses.reactivate(auth, id, meta(req));
  }
}
