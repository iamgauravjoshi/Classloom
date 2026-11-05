import {
  ACADEMIC_STATUSES,
  createRoomRequestSchema,
  type Room,
  roomSchema,
  type RoomsResponse,
  roomsResponseSchema,
  updateRoomRequestSchema,
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
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { withNullableProperties } from '../../core/http/nullable-openapi';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { RequirePermission } from '../iam/require-permission.decorator';
import { auditMeta } from './academics-write';
import { RoomsService } from './rooms.service';

class RoomDto extends withNullableProperties(createZodDto(roomSchema)) {}
class RoomsResponseDto extends withNullableProperties(createZodDto(roomsResponseSchema)) {}
class CreateRoomRequestDto extends createZodDto(createRoomRequestSchema) {}
class UpdateRoomRequestDto extends createZodDto(updateRoomRequestSchema.strict()) {}
class ListRoomsQueryDto extends createZodDto(
  z.object({ campusId: z.uuid().optional(), status: z.enum(ACADEMIC_STATUSES).optional() }),
) {}

const NOT_FOUND = 'No such room in this school';
const NO_SESSION = 'No valid session';
const NEEDS_MANAGE = 'Needs classes.manage (type permission-denied)';

@ApiTags('academics')
@ApiCookieAuth()
@Controller('academics/rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @RequirePermission('classes.view')
  @ApiOperation({
    operationId: 'listRooms',
    summary: 'Rooms, optionally of one campus or status; active first, then by name',
  })
  @ApiOkResponse({ type: RoomsResponseDto })
  @ApiBadRequestResponse({ description: 'A query parameter is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: 'Needs classes.view (type permission-denied)' })
  list(
    @CurrentAuth() auth: RequestAuth,
    @Query() query: ListRoomsQueryDto,
  ): Promise<RoomsResponse> {
    return this.rooms.list(auth, query);
  }

  @Post()
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'createRoom', summary: 'Add a room on a campus; at most 500' })
  @ApiCreatedResponse({ type: RoomDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: 'No such campus in this school' })
  @ApiConflictResponse({ description: 'name-taken (field name) or academics-limit' })
  create(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CreateRoomRequestDto,
    @Req() req: Request,
  ): Promise<Room> {
    return this.rooms.create(auth, body, auditMeta(req));
  }

  @Patch(':id')
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'updateRoom', summary: "Change a room's details" })
  @ApiOkResponse({ type: RoomDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'name-taken (field name)' })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Body() body: UpdateRoomRequestDto,
    @Req() req: Request,
  ): Promise<Room> {
    return this.rooms.update(auth, id, body, auditMeta(req));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('classes.manage')
  @ApiOperation({
    operationId: 'archiveRoom',
    summary: 'Archive a room: its sections keep it, new ones cannot pick it',
  })
  @ApiOkResponse({ type: RoomDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  archive(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Room> {
    return this.rooms.setStatus(auth, id, 'ARCHIVED', auditMeta(req));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'restoreRoom', summary: 'Restore an archived room' })
  @ApiOkResponse({ type: RoomDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  restore(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Room> {
    return this.rooms.setStatus(auth, id, 'ACTIVE', auditMeta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'deleteRoom', summary: 'Delete a room no section uses' })
  @ApiNoContentResponse({ description: 'The room was deleted.' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'in-use, with counts { sections }' })
  async remove(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.rooms.remove(auth, id, auditMeta(req));
  }
}
