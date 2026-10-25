export type Identifier =
  | { kind: 'email'; value: string }
  | { kind: 'mobile'; value: string }
  | { kind: 'invalid'; value: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** Normalises an Indian mobile number in any common written form to E.164 (`+91XXXXXXXXXX`). */
export function normalizeIndianMobile(raw: string): string | null {
  let digits = raw.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+')) {
    if (!digits.startsWith('+91')) return null;
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return INDIAN_MOBILE.test(digits) ? `+91${digits}` : null;
}

/** Classifies a login identifier typed into a single "email or mobile" field. */
export function parseIdentifier(raw: string): Identifier {
  const value = raw.trim();
  if (value.includes('@')) {
    const email = value.toLowerCase();
    return EMAIL.test(email) ? { kind: 'email', value: email } : { kind: 'invalid', value };
  }
  const mobile = normalizeIndianMobile(value);
  return mobile ? { kind: 'mobile', value: mobile } : { kind: 'invalid', value };
}
