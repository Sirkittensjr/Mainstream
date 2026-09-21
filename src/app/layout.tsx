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
    default: "FayTarra — Share what you're into",
    template: '%s · FayTarra',
  },
  description:
    "Music, jokes, gaming, art, food, sports, random moments. Post what you're into, find people who get it, and have some fun.",
  applicationName: 'FayTarra',
  appleWebApp: { capable: true, title: 'FayTarra', statusBarStyle: 'black-translucent' },
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: "FayTarra — Share what you're into",
    description:
      "Whatever you want to share, there's a place for it here. Post it, find people who get it, have some fun.",
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
