// Verhoeff checksum tables (dihedral group D5).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffValid(digits: string): boolean {
  let check = 0;
  [...digits].reverse().forEach((ch, i) => {
    check = D[check]![P[i % 8]![Number(ch)]!]!;
  });
  return check === 0;
}

const stripSpaces = (s: string) => s.replace(/\s/g, '');

export function isValidPincode(s: string): boolean {
  return /^[1-9]\d{5}$/.test(s.trim());
}

/** 12 digits, first digit 2–9, valid Verhoeff checksum. Spaces between groups are allowed. */
export function isValidAadhaar(s: string): boolean {
  const digits = stripSpaces(s);
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValid(digits);
}

export function maskAadhaar(s: string): string {
  return `XXXX-XXXX-${stripSpaces(s).slice(-4)}`;
}

export function isValidIFSC(s: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s.trim().toUpperCase());
}
