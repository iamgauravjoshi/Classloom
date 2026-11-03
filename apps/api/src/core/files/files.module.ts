import { Module } from '@nestjs/common';

import { FILE_STORAGE, S3FileStorage } from './file-storage';
import { FilesService } from './files.service';
import { ImageIntake } from './image-intake';

/** S3 file storage, safe image intake and the `files` table. */
@Module({
  providers: [{ provide: FILE_STORAGE, useClass: S3FileStorage }, FilesService, ImageIntake],
  exports: [FILE_STORAGE, FilesService, ImageIntake],
})
export class FilesModule {}
