/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Emit a self-contained Node server at .next/standalone/server.js.
   *
   * FayTarra is server-rendered — server actions, dynamic RSC pages, route
   * handlers and uploads — so there is no static bundle to hand a CDN. This
   * output is what container and Node hosts (Cloud Run, Fly, Render, Railway,
   * Docker) expect, and it keeps the image small by tracing only the
   * dependencies actually used.
   *
   * Vercel builds Next.js with its own output pipeline, so we leave it alone
   * there rather than handing it a second, competing server bundle.
   */
  output: process.env.VERCEL ? undefined : 'standalone',
  images: {
    // Sample/seed content uses remote placeholder imagery. Real uploads are
    // served from the app itself (/api/media/... or Supabase Storage).
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
