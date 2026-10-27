import { parseIdentifier } from '@classloom/utils';
import { z } from 'zod';

/** An email address, trimmed and lower-cased. A mobile number is rejected. */
export const emailField = z.string().transform((raw, ctx) => {
  const id = parseIdentifier(raw);
  if (id.kind !== 'email') {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid email address', input: raw });
    return z.NEVER;
  }
  return id.value;
});
