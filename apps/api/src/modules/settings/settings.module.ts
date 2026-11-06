import { Module } from '@nestjs/common';

import { IamModule } from '../iam/iam.module';
import { NumberSeriesController } from './number-series.controller';
import { NumberSeriesService } from './number-series.service';

/**
 * School-wide settings (Part 6a spec): the number series. `NumberSeriesService.next()` is exported
 * for the modules that issue numbers (Phase 2 admissions and fees).
 */
@Module({
  imports: [IamModule],
  controllers: [NumberSeriesController],
  providers: [NumberSeriesService],
  exports: [NumberSeriesService],
})
export class SettingsModule {}
