/** Shape of the argument Serwist passes to a runtime-caching `matcher`. */
export interface CacheMatchContext {
  url: URL;
  request: Request;
  sameOrigin: boolean;
}

/**
 * Only hashed, immutable build assets are cached at runtime. API responses, HTML pages and RSC
 * payloads carry personal data (students, fees) and must never be stored on shared school devices.
 */
export function isCacheableStaticAsset({ url, sameOrigin }: CacheMatchContext): boolean {
  return sameOrigin && url.pathname.startsWith('/_next/static/') && !url.searchParams.has('_rsc');
}
