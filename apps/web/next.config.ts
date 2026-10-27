import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Source-consumed workspace packages (shadcn components and the generated API client).
  transpilePackages: ['@classloom/ui', '@classloom/api-client'],
  poweredByHeader: false,
  // The browser reaches the API only through this same-site proxy, so the session cookie is
  // first party (Safari blocks third-party cookies). Rewrites are fixed at build time: set
  // API_INTERNAL_URL when building, not only when starting.
  rewrites() {
    return Promise.resolve([
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/:path*`,
      },
    ]);
  },
};

export default withSerwist(withNextIntl(nextConfig));
