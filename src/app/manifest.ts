import type { MetadataRoute } from 'next';

/**
 * Installable web app manifest. FayTarra is built mobile-first and standalone so it
 * can be wrapped as an iOS/Android shell later without rewriting the UI.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FayTarra — Share what you're into",
    short_name: 'FayTarra',
    description:
      "Music, jokes, gaming, art, food, sports, random moments. Post what you're into and find people who get it.",
    start_url: '/home',
    display: 'standalone',
    background_color: '#06060A',
    theme_color: '#06060A',
    orientation: 'portrait',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
