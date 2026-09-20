import Link from 'next/link';

const SIZES = {
  xs: 'h-7 w-7 text-[11px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-24 w-24 text-3xl',
} as const;

const GRADIENTS = [
  'linear-gradient(135deg,#FF5C39,#FFC93C)',
  'linear-gradient(135deg,#7C5CFF,#FF5C39)',
  'linear-gradient(135deg,#3DDC97,#7C5CFF)',
  'linear-gradient(135deg,#FF3D6E,#FFC93C)',
  'linear-gradient(135deg,#38BDF8,#7C5CFF)',
  'linear-gradient(135deg,#FFC93C,#3DDC97)',
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
  const inner = src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${displayName || username} profile picture`}
      className={`${SIZES[size]} shrink-0 rounded-full object-cover ${ring ? 'ring-2 ring-ember/70 ring-offset-2 ring-offset-ink-950' : ''}`}
    />
  ) : (
    <span
      aria-hidden
      className={`${SIZES[size]} flex shrink-0 items-center justify-center rounded-full font-display font-bold text-ink-950 ${
        ring ? 'ring-2 ring-ember/70 ring-offset-2 ring-offset-ink-950' : ''
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
