/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Sample/seed content uses remote placeholder imagery. Real uploads are
    // served from the app itself (/api/media/... or Supabase Storage).
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
