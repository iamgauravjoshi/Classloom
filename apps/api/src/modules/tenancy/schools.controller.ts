import type { CodeAvailabilityResponse, PublicSchool } from '@classloom/contracts';
import { normaliseSchoolCode } from '@classloom/utils';
import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { PublicThrottlerGuard } from '../../core/http/public-throttler.guard';
import { REGISTRATION_THROTTLER } from '../../core/http/throttler-names';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CodeAvailabilityQueryDto, CodeAvailabilityResponseDto, PublicSchoolDto } from './dto';
import { SchoolCodeService } from './school-code.service';

@ApiTags('schools')
@Controller('schools')
export class SchoolsController {
  constructor(
    private readonly codes: SchoolCodeService,
    private readonly prisma: PrismaService,
  ) {}

  // Declared before `:code/public`; the two paths cannot collide (different segment counts).
  @Get('code-availability')
  @UseGuards(PublicThrottlerGuard)
  @SkipThrottle({ [REGISTRATION_THROTTLER]: true })
  @ApiOperation({ operationId: 'getCodeAvailability', summary: 'Check a school code' })
  @ApiOkResponse({ type: CodeAvailabilityResponseDto })
  @ApiTooManyRequestsResponse({ description: 'More than 60 checks per minute from this address' })
  checkAvailability(@Query() query: CodeAvailabilityQueryDto): Promise<CodeAvailabilityResponse> {
    return this.codes.checkAvailability(query);
  }

  @Get(':code/public')
  @ApiOperation({ operationId: 'getPublicSchool', summary: 'Public profile of an active school' })
  @ApiOkResponse({ type: PublicSchoolDto })
  @ApiNotFoundResponse({ description: 'No active school with this code' })
  async getPublic(@Param('code') raw: string): Promise<PublicSchool> {
    const code = normaliseSchoolCode(raw);
    const tenant = await this.prisma.tenant.findFirst({
      where: { code, status: 'ACTIVE' },
      select: { code: true, name: true, city: true, state: true },
    });
    if (!tenant) throw new NotFoundException('School not found');
    return {
      code: tenant.code.toUpperCase(),
      name: tenant.name,
      city: tenant.city,
      state: tenant.state,
    };
  }
}
