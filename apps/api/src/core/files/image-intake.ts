import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

/** Uploads over 2 MB are refused before decoding. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
/** Each side must be at least this many pixels. */
export const MIN_LOGO_SIDE = 64;
/** The longest side of the stored PNG; smaller images are never enlarged. */
export const MAX_LOGO_SIDE = 512;
/** Decompression-bomb guard: sharp refuses inputs with more pixels than this. */
export const LIMIT_INPUT_PIXELS = 25_000_000;

export type ImageRejectionReason = 'type' | 'size' | 'dimensions' | 'decode';

/** The upload is not an acceptable image; maps to 422 `logo-invalid` with this `reason`. */
export class ImageRejectedError extends Error {
  constructor(readonly reason: ImageRejectionReason) {
    super(`Image rejected: ${reason}`);
    this.name = 'ImageRejectedError';
  }
}

export interface LogoImage {
  /** PNG bytes, auto-rotated, at most 512 px on the longest side, with no metadata. */
  data: Buffer;
  width: number;
  height: number;
  /** SHA-256 of `data`. */
  sha256: Buffer;
}

type AcceptedFormat = 'png' | 'jpeg' | 'webp';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The format named by the file's magic bytes, or undefined. Checked before sharp sees the bytes,
 * so SVG, GIF, HEIC and the rest are never handed to a decoder at all.
 */
function sniffFormat(input: Buffer): AcceptedFormat | undefined {
  if (input.length >= 8 && input.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) {
    return 'jpeg';
  }
  if (
    input.length >= 12 &&
    input.toString('latin1', 0, 4) === 'RIFF' &&
    input.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return undefined;
}

/**
 * Turns an untrusted upload into a safe logo PNG. The format is judged by the decoded content,
 * never by the file name or `Content-Type`.
 */
@Injectable()
export class ImageIntake {
  async toLogoPng(input: Buffer): Promise<LogoImage> {
    if (input.length > MAX_LOGO_BYTES) throw new ImageRejectedError('size');
    const sniffed = sniffFormat(input);
    if (!sniffed) throw new ImageRejectedError('type');

    // failOn 'error' is stricter than 'truncated' (sharp's levels run none < truncated < error <
    // warning), so a truncated JPEG or PNG is refused as well (see the truncated fixtures).
    const options = { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'error' } as const;
    // Header only: sharp reads the dimensions without decoding pixels, and refuses a header that
    // declares more than LIMIT_INPUT_PIXELS.
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(input, options).metadata();
    } catch {
      throw new ImageRejectedError('decode');
    }
    if (metadata.format !== sniffed) throw new ImageRejectedError('type');
    const { width, height } = metadata;
    if (!width || !height) throw new ImageRejectedError('decode');
    if (width * height > LIMIT_INPUT_PIXELS) throw new ImageRejectedError('dimensions');
    if (width < MIN_LOGO_SIDE || height < MIN_LOGO_SIDE) {
      throw new ImageRejectedError('dimensions');
    }

    try {
      // sharp drops all metadata (EXIF, GPS, ICC, XMP) unless asked to keep it.
      const { data, info } = await sharp(input, options)
        .autoOrient()
        .resize(MAX_LOGO_SIDE, MAX_LOGO_SIDE, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });
      return {
        data,
        width: info.width,
        height: info.height,
        sha256: createHash('sha256').update(data).digest(),
      };
    } catch {
      throw new ImageRejectedError('decode');
    }
  }
}
