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
    default: 'RISE — Everyone starts at zero',
    template: '%s · RISE',
  },
  description:
    'RISE is a social platform for people who are still becoming somebody. Create, compete, get discovered, rise.',
  applicationName: 'RISE',
  appleWebApp: { capable: true, title: 'RISE', statusBarStyle: 'black-translucent' },
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'RISE — Everyone starts at zero',
    description: 'A social platform for people who are still becoming somebody.',
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
