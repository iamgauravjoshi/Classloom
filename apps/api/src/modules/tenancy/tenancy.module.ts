import { Module } from '@nestjs/common';

import { SchoolCodeService } from './school-code.service';
import { SchoolsController } from './schools.controller';

@Module({
  controllers: [SchoolsController],
  providers: [SchoolCodeService],
  exports: [SchoolCodeService],
})
export class TenancyModule {}
