import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Classloom',
    short_name: 'Classloom',
    description: 'School management for Indian schools',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#3D5EE1',
    background_color: '#F4F6FA',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
