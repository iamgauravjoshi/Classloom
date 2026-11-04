import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { HealthController } from './health.controller';

@Module({ imports: [FilesModule], controllers: [HealthController] })
export class HealthModule {}
