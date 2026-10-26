/** `asha@school.in` becomes `a***@school.in`; a one-character local part becomes `*@school.in`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return local.length <= 1 ? `*${domain}` : `${local[0]}***${domain}`;
}
