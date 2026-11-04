import type { HealthResponse } from '@classloom/contracts';
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../../modules/auth/public.decorator';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { HealthResponseDto } from './health.dto';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'getHealth', summary: 'Database, Redis and storage connectivity' })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const [database, redis, storage] = await Promise.all([
      this.databaseUp(),
      this.redis.ping(),
      this.storage.ping(),
    ]);
    // Storage is reported but never fails the check: only uploads and logo reads depend on it.
    const healthy = database && redis;
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: healthy ? 'ok' : 'error',
      checks: {
        database: database ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
        storage: storage ? 'up' : 'down',
      },
    };
  }

  private async databaseUp(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
