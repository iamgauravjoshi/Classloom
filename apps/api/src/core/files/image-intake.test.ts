import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { ImageIntake, ImageRejectedError, MAX_LOGO_BYTES } from './image-intake';

const fixtures = path.resolve(__dirname, '../../../test/fixtures/images');
const fixture = (name: string) => readFile(path.join(fixtures, name));

async function rejection(input: Buffer): Promise<ImageRejectedError> {
  const error: unknown = await new ImageIntake().toLogoPng(input).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ImageRejectedError);
  return error as ImageRejectedError;
}

describe('ImageIntake.toLogoPng', () => {
  const intake = new ImageIntake();

  it.each(['landscape-1024x768.png', 'landscape-1024x768.jpg', 'landscape-1024x768.webp'])(
    'turns %s into a PNG with the longest side 512 and the aspect ratio kept',
    async (name) => {
      const result = await intake.toLogoPng(await fixture(name));
      expect(result).toMatchObject({ width: 512, height: 384 });
      const meta = await sharp(result.data).metadata();
      expect(meta).toMatchObject({ format: 'png', width: 512, height: 384 });
      expect(result.sha256).toEqual(createHash('sha256').update(result.data).digest());
    },
  );

  it('never enlarges a small image', async () => {
    const result = await intake.toLogoPng(await fixture('small-300x100.png'));
    expect(result).toMatchObject({ width: 300, height: 100 });
  });

  it('turns an EXIF-rotated photo upright and strips its metadata, GPS included', async () => {
    const result = await intake.toLogoPng(await fixture('exif-orientation-6-gps.jpg'));
    expect(result.width).toBeLessThan(result.height);
    expect(result).toMatchObject({ width: 256, height: 512 });
    const meta = await sharp(result.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it.each(['svg-renamed.png', 'square-200x200.gif'])(
    'rejects %s as the wrong type',
    async (name) => {
      expect((await rejection(await fixture(name))).reason).toBe('type');
    },
  );

  it('rejects anything over 2 MB before decoding it', async () => {
    const png = await fixture('small-300x100.png');
    const padded = Buffer.concat([png, Buffer.alloc(MAX_LOGO_BYTES + 1 - png.length)]);
    expect(padded.length).toBe(2 * 1024 * 1024 + 1);
    expect((await rejection(padded)).reason).toBe('size');
  });

  it('rejects an image under 64 px on a side', async () => {
    expect((await rejection(await fixture('narrow-63x200.png'))).reason).toBe('dimensions');
  });

  it('rejects a truncated PNG as undecodable', async () => {
    expect((await rejection(await fixture('truncated.png'))).reason).toBe('decode');
  });

  it('rejects a header declaring 30000x30000 quickly, without decoding it', async () => {
    const started = performance.now();
    const { reason } = await rejection(await fixture('header-30000x30000.png'));
    expect(['decode', 'dimensions']).toContain(reason);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('rejects an empty upload as the wrong type', async () => {
    expect((await rejection(Buffer.alloc(0))).reason).toBe('type');
  });
});
