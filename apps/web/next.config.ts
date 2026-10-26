import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Source-consumed workspace packages (shadcn components and the generated API client).
  transpilePackages: ['@classloom/ui', '@classloom/api-client'],
  poweredByHeader: false,
};

export default withSerwist(withNextIntl(nextConfig));
