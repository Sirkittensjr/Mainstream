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
  // Which framework built the site is nobody's business.
  poweredByHeader: false,
  /**
   * Baseline protection on every response.
   *
   * `frame-ancestors 'none'` and X-Frame-Options stop another site putting
   * FayTarra in an invisible frame and steering somebody's taps onto Follow,
   * Report or Delete account. nosniff stops an uploaded file being run as
   * something it is not. The camera and microphone are allowed for FayTarra
   * itself — recording needs them — and for nothing it might embed.
   *
   * Deliberately not a full Content-Security-Policy: Next inlines scripts, and
   * a policy that has to allow them buys little for the risk of blocking the
   * app. This is the part that is safe to apply everywhere.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
          },
        ],
      },
    ];
  },
  images: {
    // Sample/seed content uses remote placeholder imagery. Real uploads are
    // served from the app itself (/api/media/... or Supabase Storage).
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
