import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM. Returns `iv ‖ tag ‖ ciphertext`, with a fresh random IV per call. */
export function encryptSecret(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

/** Reverses `encryptSecret`; throws if the box was altered, truncated or made under another key. */
export function decryptSecret(key: Buffer, box: Buffer): string {
  if (box.length < IV_BYTES + TAG_BYTES) throw new Error('Secret box is too short');
  const decipher = createDecipheriv('aes-256-gcm', key, box.subarray(0, IV_BYTES));
  decipher.setAuthTag(box.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  const data = box.subarray(IV_BYTES + TAG_BYTES);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
