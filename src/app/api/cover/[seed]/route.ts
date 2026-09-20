import { NextResponse } from 'next/server';

/**
 * Generated cover art for sample content.
 *
 * Seed data points at this route instead of an external image host, so a fresh
 * install looks populated even with no network access, and no third party ever
 * sees who is browsing RISE.
 */

const PALETTES: [string, string, string][] = [
  ['#FF5C39', '#FFC93C', '#2A1206'],
  ['#7C5CFF', '#FF3D6E', '#120A2A'],
  ['#3DDC97', '#38BDF8', '#062018'],
  ['#FFC93C', '#3DDC97', '#231A05'],
  ['#FF3D6E', '#7C5CFF', '#26061A'],
  ['#38BDF8', '#FF5C39', '#04121F'],
];

function hash(value: string): number {
  let out = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    out ^= value.charCodeAt(i);
    out = Math.imul(out, 16777619);
  }
  return out >>> 0;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ seed: string }> },
) {
  const { seed: rawSeed } = await params;
  const seed = decodeURIComponent(rawSeed);
  const h = hash(seed);
  const [a, b, bg] = PALETTES[h % PALETTES.length];
  const label = seed.split('-')[0] ?? '';

  const blobs = Array.from({ length: 5 }, (_, i) => {
    const n = hash(`${seed}:${i}`);
    const cx = 80 + (n % 640);
    const cy = 120 + ((n >> 8) % 760);
    const r = 140 + ((n >> 16) % 240);
    const fill = i % 2 === 0 ? a : b;
    const opacity = 0.38 + ((n >> 5) % 34) / 100;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity.toFixed(2)}"/>`;
  }).join('');

  // A column chart climbing to the right — the RISE motif, used as texture.
  const bars = Array.from({ length: 7 }, (_, i) => {
    const n = hash(`${seed}:bar:${i}`);
    const height = 90 + i * 46 + (n % 120);
    return `<rect x="${64 + i * 98}" y="${960 - height}" width="46" rx="23" height="${height}" fill="#ffffff" opacity="0.13"/>`;
  }).join('');

  const arrowY = 300 + (h % 260);
  const arrow = `<path d="M110 ${arrowY + 150} L400 ${arrowY - 60} L690 ${arrowY + 150}" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <defs>
    <linearGradient id="g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="${a}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${b}" stop-opacity="0.35"/>
    </linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="72"/></filter>
  </defs>
  <rect width="800" height="1000" fill="${bg}"/>
  <g filter="url(#blur)">${blobs}</g>
  <rect width="800" height="1000" fill="url(#g)"/>
  ${arrow}
  ${bars}
  <rect x="0" y="760" width="800" height="240" fill="#000000" opacity="0.28"/>
  <text x="56" y="906" font-family="'Space Grotesk',Inter,system-ui,sans-serif" font-size="52" font-weight="700" fill="#ffffff" opacity="0.92" letter-spacing="1">${escapeXml(
    label.toUpperCase(),
  )}</text>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] as string,
  );
}
