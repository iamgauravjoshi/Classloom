import { isCacheableStaticAsset } from './sw-cache-rules';

const ORIGIN = 'https://school.classloom.in';
const req = (url: string, destination: RequestDestination = '') => ({
  url: new URL(url, ORIGIN),
  request: { destination } as Request,
  sameOrigin: url.startsWith('/'),
});

describe('isCacheableStaticAsset', () => {
  it('caches hashed Next.js build assets and fonts', () => {
    expect(isCacheableStaticAsset(req('/_next/static/chunks/app-1a2b.js', 'script'))).toBe(true);
    expect(isCacheableStaticAsset(req('/_next/static/media/roboto.woff2', 'font'))).toBe(true);
  });

  // Responses carrying student or fee data must never land in Cache Storage on shared devices.
  it('never caches API responses', () => {
    expect(
      isCacheableStaticAsset({ ...req('https://api.classloom.in/students'), sameOrigin: false }),
    ).toBe(false);
    expect(isCacheableStaticAsset(req('/api/students'))).toBe(false);
  });

  it('never caches HTML pages', () => {
    expect(isCacheableStaticAsset(req('/en/students', 'document'))).toBe(false);
  });

  it('never caches React Server Component payloads', () => {
    expect(isCacheableStaticAsset(req('/en/students?_rsc=abc'))).toBe(false);
  });
});
