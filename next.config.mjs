/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Emit a self-contained Node server at .next/standalone/server.js.
   *
   * FayTarra is server-rendered — server actions, dynamic RSC pages, route
   * handlers and uploads — so there is no static bundle to hand a CDN. This
   * output is what container and Node hosts (Cloud Run, Fly, Render, Railway,
   * Docker, App Hosting) expect, and it keeps the deployed image small by
   * tracing only the dependencies actually used.
   */
  output: 'standalone',
  images: {
    // Sample/seed content uses remote placeholder imagery. Real uploads are
    // served from the app itself (/api/media/... or Supabase Storage).
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
