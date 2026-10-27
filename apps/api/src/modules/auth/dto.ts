import { authSessionSchema } from '@classloom/contracts';
import { createZodDto } from 'nestjs-zod';

export class AuthSessionDto extends createZodDto(authSessionSchema) {}
