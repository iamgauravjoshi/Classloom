import { Global, Module } from '@nestjs/common';

import { PlatformPrismaService } from './platform-prisma.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, PlatformPrismaService],
  exports: [PrismaService, PlatformPrismaService],
})
export class PrismaModule {}
