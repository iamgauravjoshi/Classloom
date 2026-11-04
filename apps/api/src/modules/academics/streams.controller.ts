import {
  createStreamRequestSchema,
  type StarterStreamsAddedResponse,
  starterStreamsAddedResponseSchema,
  type Stream,
  streamSchema,
  type StreamsResponse,
  streamsResponseSchema,
  updateStreamRequestSchema,
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
import { StreamsService } from './streams.service';

class StreamDto extends withNullableProperties(createZodDto(streamSchema)) {}
class StreamsResponseDto extends withNullableProperties(createZodDto(streamsResponseSchema)) {}
class StarterStreamsAddedResponseDto extends withNullableProperties(
  createZodDto(starterStreamsAddedResponseSchema),
) {}
class CreateStreamRequestDto extends createZodDto(createStreamRequestSchema) {}
class UpdateStreamRequestDto extends createZodDto(updateStreamRequestSchema) {}

const NOT_FOUND = 'No such stream in this school';
const NO_SESSION = 'No valid session';
const NEEDS_MANAGE = 'Needs classes.manage (type permission-denied)';

@ApiTags('academics')
@ApiCookieAuth()
@Controller('academics/streams')
export class StreamsController {
  constructor(private readonly streams: StreamsService) {}

  @Get()
  @RequirePermission('classes.view')
  @ApiOperation({ operationId: 'listStreams', summary: 'All streams, active first, then by name' })
  @ApiOkResponse({ type: StreamsResponseDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: 'Needs classes.view (type permission-denied)' })
  list(@CurrentAuth() auth: RequestAuth): Promise<StreamsResponse> {
    return this.streams.list(auth);
  }

  @Post()
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'createStream', summary: 'Add a stream; at most 20 per school' })
  @ApiCreatedResponse({ type: StreamDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiConflictResponse({ description: 'name-taken (field name) or academics-limit' })
  create(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: CreateStreamRequestDto,
    @Req() req: Request,
  ): Promise<Stream> {
    return this.streams.create(auth, body, auditMeta(req));
  }

  @Post('starter')
  @RequirePermission('classes.manage')
  @ApiOperation({
    operationId: 'addStarterStreams',
    summary: 'Add Science, Commerce and Humanities, skipping names the school already has',
  })
  @ApiCreatedResponse({ type: StarterStreamsAddedResponseDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiConflictResponse({ description: 'academics-limit' })
  addStarter(
    @CurrentAuth() auth: RequestAuth,
    @Req() req: Request,
  ): Promise<StarterStreamsAddedResponse> {
    return this.streams.addStarter(auth, auditMeta(req));
  }

  @Patch(':id')
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'updateStream', summary: 'Rename a stream' })
  @ApiOkResponse({ type: StreamDto })
  @ApiBadRequestResponse({ description: 'A field is not valid' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'name-taken (field name)' })
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Body() body: UpdateStreamRequestDto,
    @Req() req: Request,
  ): Promise<Stream> {
    return this.streams.update(auth, id, body, auditMeta(req));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'archiveStream', summary: 'Archive a stream' })
  @ApiOkResponse({ type: StreamDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  archive(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Stream> {
    return this.streams.setStatus(auth, id, 'ARCHIVED', auditMeta(req));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('classes.manage')
  @ApiOperation({ operationId: 'restoreStream', summary: 'Restore an archived stream' })
  @ApiOkResponse({ type: StreamDto })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  restore(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Stream> {
    return this.streams.setStatus(auth, id, 'ACTIVE', auditMeta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('classes.manage')
  @ApiOperation({
    operationId: 'deleteStream',
    summary: 'Delete a stream no section or class subject uses',
  })
  @ApiNoContentResponse({ description: 'The stream was deleted.' })
  @ApiUnauthorizedResponse({ description: NO_SESSION })
  @ApiForbiddenResponse({ description: NEEDS_MANAGE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'in-use, with counts { sections, classSubjects }' })
  async remove(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.streams.remove(auth, id, auditMeta(req));
  }
}
