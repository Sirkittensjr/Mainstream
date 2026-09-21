import type { MetadataRoute } from 'next';

/**
 * Installable web app manifest. FayTarra is built mobile-first and standalone so it
 * can be wrapped as an iOS/Android shell later without rewriting the UI.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FayTarra — Where the community decides what they like',
    short_name: 'FayTarra',
    description:
      'Post whatever you are into. Everyone else weighs in with likes, comments and a rating out of 10.',
    start_url: '/home',
    display: 'standalone',
    background_color: '#06060A',
    theme_color: '#06060A',
    orientation: 'portrait',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
