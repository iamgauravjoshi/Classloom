import {
  codeAvailabilityQuerySchema,
  codeAvailabilityResponseSchema,
  publicSchoolSchema,
  resendRegistrationRequestSchema,
  schoolRegistrationAcceptedSchema,
  schoolRegistrationRequestSchema,
  verifyRegistrationRequestSchema,
  verifyRegistrationResponseSchema,
} from '@classloom/contracts';
import { createZodDto } from 'nestjs-zod';

export class CodeAvailabilityQueryDto extends createZodDto(codeAvailabilityQuerySchema) {}
export class CodeAvailabilityResponseDto extends createZodDto(codeAvailabilityResponseSchema) {}
export class PublicSchoolDto extends createZodDto(publicSchoolSchema) {}
export class SchoolRegistrationRequestDto extends createZodDto(schoolRegistrationRequestSchema) {}
export class SchoolRegistrationAcceptedDto extends createZodDto(schoolRegistrationAcceptedSchema) {}
export class ResendRegistrationRequestDto extends createZodDto(resendRegistrationRequestSchema) {}
export class VerifyRegistrationRequestDto extends createZodDto(verifyRegistrationRequestSchema) {}
export class VerifyRegistrationResponseDto extends createZodDto(verifyRegistrationResponseSchema) {}
