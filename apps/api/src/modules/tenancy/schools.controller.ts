import type { CodeAvailabilityResponse, PublicSchool } from '@classloom/contracts';
import { normaliseSchoolCode } from '@classloom/utils';
import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  @ApiOperation({ operationId: 'getCodeAvailability', summary: 'Check a school code' })
  @ApiOkResponse({ type: CodeAvailabilityResponseDto })
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
