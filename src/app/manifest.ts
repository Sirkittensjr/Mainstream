import type { MetadataRoute } from 'next';

/**
 * Installable web app manifest. FayTarra is built mobile-first and standalone so it
 * can be wrapped as an iOS/Android shell later without rewriting the UI.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FayTarra — Everyone starts at zero',
    short_name: 'FayTarra',
    description: 'A social platform for people who are still becoming somebody.',
    start_url: '/home',
    display: 'standalone',
    background_color: '#06060A',
    theme_color: '#06060A',
    orientation: 'portrait',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
