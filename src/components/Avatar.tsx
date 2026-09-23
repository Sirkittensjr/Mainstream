import Image from 'next/image';
import Link from 'next/link';
import { isVectorImage } from '@/lib/image';

const SIZES = {
  xs: 'h-7 w-7 text-[11px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-24 w-24 text-3xl',
} as const;

/**
 * The same sizes in pixels, so the optimiser knows what to actually send.
 *
 * An avatar drawn at 36 across was downloading whatever the person uploaded —
 * a few megabytes of phone camera, scaled down by the browser after paying
 * for all of it. These are the numbers that stop that happening.
 */
const PIXELS: Record<keyof typeof SIZES, number> = {
  xs: 28,
  sm: 36,
  md: 44,
  lg: 64,
  xl: 96,
};

const GRADIENTS = [
  'linear-gradient(135deg,#FF3D9A,#FFB443)',
  'linear-gradient(135deg,#7C5CFF,#FF3D9A)',
  'linear-gradient(135deg,#3DDC97,#7C5CFF)',
  'linear-gradient(135deg,#7C5CFF,#FFB443)',
  'linear-gradient(135deg,#38BDF8,#7C5CFF)',
  'linear-gradient(135deg,#FFB443,#3DDC97)',
];

function hash(value: string): number {
  let out = 0;
  for (let i = 0; i < value.length; i += 1) out = (out * 31 + value.charCodeAt(i)) >>> 0;
  return out;
}

export interface AvatarProps {
  username: string;
  displayName?: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  href?: string | false;
  ring?: boolean;
}

/**
 * Avatars fall back to a deterministic gradient + initials, so a brand new
 * account never looks like a broken image.
 */
export function Avatar({
  username,
  displayName,
  src,
  size = 'md',
  href,
  ring = false,
}: AvatarProps) {
  const initials = (displayName || username).trim().slice(0, 2).toUpperCase();
  const gradient = GRADIENTS[hash(username) % GRADIENTS.length];
  const pixels = PIXELS[size];
  const inner = src ? (
    <Image
      src={src}
      alt={`${displayName || username} profile picture`}
      width={pixels}
      height={pixels}
      // Twice the drawn size covers a retina screen and nothing beyond it.
      sizes={`${pixels * 2}px`}
      unoptimized={isVectorImage(src)}
      className={`${SIZES[size]} shrink-0 rounded-full object-cover ${ring ? 'ring-2 ring-fay/70 ring-offset-2 ring-offset-ink-950' : ''}`}
    />
  ) : (
    <span
      aria-hidden
      className={`${SIZES[size]} flex shrink-0 items-center justify-center rounded-full font-display font-bold text-ink-950 ${
        ring ? 'ring-2 ring-fay/70 ring-offset-2 ring-offset-ink-950' : ''
      }`}
      style={{ backgroundImage: gradient }}
    >
      {initials}
    </span>
  );

  if (href === false) return inner;
  return (
    <Link href={href ?? `/u/${username}`} aria-label={`${displayName || username} profile`}>
      {inner}
    </Link>
  );
}
