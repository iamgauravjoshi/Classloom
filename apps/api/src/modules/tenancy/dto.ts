import {
  codeAvailabilityQuerySchema,
  codeAvailabilityResponseSchema,
  publicSchoolSchema,
} from '@classloom/contracts';
import { createZodDto } from 'nestjs-zod';

export class CodeAvailabilityQueryDto extends createZodDto(codeAvailabilityQuerySchema) {}
export class CodeAvailabilityResponseDto extends createZodDto(codeAvailabilityResponseSchema) {}
export class PublicSchoolDto extends createZodDto(publicSchoolSchema) {}
