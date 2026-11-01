import { parseIdentifier } from '@classloom/utils';
import { z } from 'zod';

/** An email address, trimmed and lower-cased. A mobile number is rejected. */
export const emailField = z
  .string()
  // Bounds the input before any parsing; an address is at most 254 characters (RFC 5321).
  .max(254, 'Enter a valid email address')
  .transform((raw, ctx) => {
    const id = parseIdentifier(raw);
    if (id.kind !== 'email') {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email address', input: raw });
      return z.NEVER;
    }
    return id.value;
  });
