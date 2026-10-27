import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * The API's only database client runs as the restricted app role. The owner-role
 * PlatformPrismaService is deliberately not here: only the CLI (CliModule) provides it.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
