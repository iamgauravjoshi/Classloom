import {
  createHouseRequestSchema,
  type House,
  houseSchema,
  type HousesResponse,
  housesResponseSchema,
  updateHouseRequestSchema,
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
import { HousesService } from './houses.service';

class HouseDto extends withNullableProperties(createZodDto(houseSchema)) {}
class HousesResponseDto extends withNullableProperties(createZodDto(housesResponseSchema)) {}
class CreateHouseRequestDto extends createZodDto(createHouseRequestSchema) {}
class UpdateHouseRequestDto extends createZodDto(
  updateHouseRequestSchema.omit({ status: true }).strict(),
) {}

const NOT_FOUND = 'No such house in this school';
const NO_SESSION = 'No valid session';
const NEEDS_MANAGE = 'Needs classes.manage (type permission-denied)';

@ApiTags('academics')
@ApiCookieAuth()
@Controller('academics/houses')
export class HousesController {
  constructor(private readonly houses: HousesService) {}

  @Get()
  @RequirePermission('classes.view')
  @ApiOperation({ operationId: 'listHouses', summary: 'All houses, active first, then by name' })
  @ApiOkResponse({ type: HousesResponseDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: 'Needs classes.view (type permission-denied)' })
  list(@CurrentAuth() auth: RequestAuth): Promise<HousesResponse> {
    return this.houses.list(auth);
  }

  @Post()
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'createHouse', summary: 'Add a house; at most 20 per school' })
  @ApiCreatedResponse({ type: HouseDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiConflictResponse({ description: 'name-taken (field name) or academics-limit' })
  create(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CreateHouseRequestDto,
    @Req() req: Request,
  ): Promise<House> {
    return this.houses.create(auth, body, auditMeta(req));
  }

  @Patch(':id')
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'updateHouse', summary: "Change a house's name or colour" })
  @ApiOkResponse({ type: HouseDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'name-taken (field name)' })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Body() body: UpdateHouseRequestDto,
    @Req() req: Request,
  ): Promise<House> {
    return this.houses.update(auth, id, body, auditMeta(req));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'archiveHouse', summary: 'Archive a house' })
  @ApiOkResponse({ type: HouseDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  archive(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<House> {
    return this.houses.setStatus(auth, id, 'ARCHIVED', auditMeta(req));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'restoreHouse', summary: 'Restore an archived house' })
  @ApiOkResponse({ type: HouseDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  restore(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<House> {
    return this.houses.setStatus(auth, id, 'ACTIVE', auditMeta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'deleteHouse', summary: 'Delete a house' })
  @ApiNoContentResponse({ description: 'The house was deleted.' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  async remove(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.houses.remove(auth, id, auditMeta(req));
  }
}
