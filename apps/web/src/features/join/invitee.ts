/** The API's mask (`asha@school.in` becomes `a***@school.in`), to compare with the preview's email. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return local.length <= 1 ? `*${domain}` : `${local[0]}***${domain}`;
}

/**
 * Whether the browser is signed in as someone other than the invitee. The preview only has the
 * masked address, so the signed-in address is masked the same way and compared; a mask that
 * matches is treated as the same person (the worst case is joining without the courtesy warning,
 * since accepting always signs in as the invitee).
 */
export function isOtherAccount(maskedInviteeEmail: string, signedInEmail: string | null): boolean {
  if (!signedInEmail) return false;
  return maskEmail(signedInEmail.toLowerCase()) !== maskedInviteeEmail.toLowerCase();
}
