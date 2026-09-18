import type { MetadataRoute } from 'next';

// Makes the dashboard installable. iPhone/iPad only allow web push for sites added to the Home Screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nadobot',
    short_name: 'Nadobot',
    description: 'Independent tool (not affiliated with Nado): trade plans that keep running while you are offline.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0f1115',
    theme_color: '#0f1115',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
