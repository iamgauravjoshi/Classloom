import { useGetMe } from '@classloom/api-client';
import { type Me, meSchema } from '@classloom/contracts';

/**
 * `GET /me`, read through the contract: the generated type shows `mobile` as a list, but the
 * API sends a string or null (E.164, `+91XXXXXXXXXX`).
 */
export function useMe() {
  return useGetMe({ query: { select: (data): Me => meSchema.parse(data) } });
}

/** A stored `+91XXXXXXXXXX` as the 10 digits people type; empty when there is none. */
export function mobileDigits(mobile: string | null): string {
  return mobile ? mobile.replace(/^\+91/, '') : '';
}
