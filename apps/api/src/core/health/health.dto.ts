import { healthResponseSchema } from '@classloom/contracts';
import { createZodDto } from 'nestjs-zod';

export class HealthResponseDto extends createZodDto(healthResponseSchema) {}
