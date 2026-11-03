import { type SchoolProfile, schoolProfileSchema } from '@classloom/contracts';
import {
  type CallHandler,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import type { Observable } from 'rxjs';

import { MAX_LOGO_BYTES } from '../../core/files/image-intake';
import { withNullableProperties } from '../../core/http/nullable-openapi';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { RequestAuth } from '../auth/request-auth';
import { RequirePermission } from '../iam/require-permission.decorator';
import { ProfileService } from './profile.service';
import { LogoInvalidException } from './school-problems';

class SchoolProfileDto extends withNullableProperties(createZodDto(schoolProfileSchema)) {}

/** The versioned URL never changes content, so it is cached for a year. */
const IMMUTABLE = 'private, max-age=31536000, immutable';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/** Only the parts of a Multer file this module reads. */
interface UploadedLogo {
  buffer: Buffer;
}

/**
 * Multer (in memory) for the single `file` field, at most 2 MB. Multer stops reading at the
 * limit and Nest turns that into 413; the logo API reports it as 422 `logo-invalid` (size).
 */
@Injectable()
export class LogoUploadInterceptor implements NestInterceptor {
  private readonly multer = new (FileInterceptor('file', {
    limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 0, parts: 1 },
  }))();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.multer.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) throw new LogoInvalidException('size');
      throw error;
    }
  }
}

@ApiTags('school')
@ApiCookieAuth()
@Controller('school/logo')
export class LogoController {
  constructor(private readonly profiles: ProfileService) {}

  @Put()
  @RequirePermission('settings.manage')
  @UseInterceptors(LogoUploadInterceptor)
  @ApiOperation({
    operationId: 'uploadSchoolLogo',
    summary: "Replace the school's logo (PNG, JPEG or WebP up to 2 MB); 10 uploads per hour",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: SchoolProfileDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  @ApiUnprocessableEntityResponse({
    description: 'Not an acceptable image (type logo-invalid, reason type|size|dimensions|decode)',
  })
  @ApiTooManyRequestsResponse({ description: 'More than 10 uploads in an hour' })
  @ApiServiceUnavailableResponse({ description: 'Storage unreachable (type storage-unavailable)' })
  upload(
    @CurrentAuth() auth: RequestAuth,
    @UploadedFile() file: UploadedLogo | undefined,
    @Req() req: Request,
  ): Promise<SchoolProfile> {
    return this.profiles.uploadLogo(auth, file?.buffer, meta(req));
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'removeSchoolLogo', summary: "Remove the school's logo" })
  @ApiNoContentResponse({ description: 'The school has no logo now.' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiForbiddenResponse({ description: 'Needs settings.manage (type permission-denied)' })
  async remove(@CurrentAuth() auth: RequestAuth, @Req() req: Request): Promise<void> {
    await this.profiles.removeLogo(auth, meta(req));
  }

  @Get()
  @ApiOperation({
    operationId: 'getSchoolLogo',
    summary: "The school's logo as PNG; `v` (the file id) makes the URL cacheable for a year",
  })
  @ApiQuery({ name: 'v', required: false, description: 'The logo file id from logoUrl' })
  @ApiProduces('image/png')
  @ApiOkResponse({ description: 'The PNG', content: { 'image/png': {} } })
  @ApiResponse({ status: 304, description: 'Not modified (If-None-Match matched the ETag)' })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  @ApiNotFoundResponse({ description: 'The school has no logo' })
  @ApiServiceUnavailableResponse({ description: 'Storage unreachable (type storage-unavailable)' })
  async get(
    @CurrentAuth() auth: RequestAuth,
    @Query('v') version: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const logo = await this.profiles.openLogo(auth, req.headers['if-none-match']);
    // Only the URL naming the current file is immutable; a stale or foreign `v` must revalidate.
    res.setHeader('Cache-Control', version === logo.fileId ? IMMUTABLE : 'private, no-cache');
    res.setHeader('ETag', `"${logo.fileId}"`);
    if (!logo.body) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return new StreamableFile(logo.body, { type: 'image/png' });
  }
}
