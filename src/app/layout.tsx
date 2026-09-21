import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'FayTarra — Where the community decides what they like',
    template: '%s · FayTarra',
  },
  description:
    'Post the music, art, gaming, food, jokes and random moments you are into. Everyone else weighs in with likes, comments and a rating out of 10.',
  applicationName: 'FayTarra',
  appleWebApp: { capable: true, title: 'FayTarra', statusBarStyle: 'black-translucent' },
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'FayTarra — Where the community decides what they like',
    description:
      'Post whatever you are into. Everyone else weighs in with likes, comments and a rating out of 10.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#06060A',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
