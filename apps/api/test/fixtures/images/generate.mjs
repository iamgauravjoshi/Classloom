// Regenerates the image fixtures used by `src/core/files/image-intake.test.ts`.
// Run from apps/api: `node test/fixtures/images/generate.mjs`. The output is deterministic.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import sharp from 'sharp';

const dir = import.meta.dirname;
const out = (name) => path.join(dir, name);

/** Deterministic noise (an LCG), so compressed images have real payload to truncate. */
function noise(width, height, channels = 3, seed = 42) {
  const data = Buffer.alloc(width * height * channels);
  let state = seed;
  for (let i = 0; i < data.length; i++) {
    state = (state * 1103515245 + 12345) >>> 0;
    data[i] = state >>> 24;
  }
  return sharp(data, { raw: { width, height, channels } });
}

/** A solid-colour image of the given size. */
function solid(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } },
  });
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A valid PNG header declaring 30000x30000 RGB with only a few bytes of image data. */
function pngBombHeader() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(30_000, 0);
  ihdr.writeUInt32BE(30_000, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.alloc(64))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

await solid(1024, 768).png().toFile(out('landscape-1024x768.png'));
await solid(1024, 768).jpeg().toFile(out('landscape-1024x768.jpg'));
await solid(1024, 768).webp().toFile(out('landscape-1024x768.webp'));
await solid(300, 100).png().toFile(out('small-300x100.png'));
await solid(63, 200).png().toFile(out('narrow-63x200.png'));
await solid(200, 200).gif().toFile(out('square-200x200.gif'));

// Stored 800x400 with EXIF orientation 6 (rotate 90 degrees clockwise to view): upright 400x800.
// It also carries GPS tags, which the intake must strip.
await solid(800, 400)
  .jpeg()
  .withExif({
    IFD0: { Make: 'Classloom Test Camera' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '28/1 36/1 0/1' },
  })
  .withMetadata({ orientation: 6 })
  .toFile(out('exif-orientation-6-gps.jpg'));

// An SVG saved under a .png name: the intake judges by content, not by name.
await writeFile(
  out('svg-renamed.png'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
    '<rect width="200" height="200" fill="#1e78c8"/></svg>\n',
);

// The first half of a valid noisy PNG.
const full = await noise(256, 256).png({ compressionLevel: 0 }).toBuffer();
await writeFile(out('truncated.png'), full.subarray(0, Math.floor(full.length / 2)));

await writeFile(out('header-30000x30000.png'), pngBombHeader());
