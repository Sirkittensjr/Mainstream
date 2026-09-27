import { ADMIN_BADGE_LABEL } from '@/lib/admin-badge';

/**
 * The mark next to an official FayTarra administrator's name.
 *
 * Rendered only where the SERVER has already decided the account is one —
 * this component takes no role and makes no judgement, it just draws. Callers
 * pass a boolean derived from the database, which is why there is no way to
 * talk this into appearing next to somebody else's name.
 *
 * A shield with a check rather than the word ADMIN: it reads at 14px beside a
 * display name, it does not compete with the name for width on a phone, and
 * it cannot be typed into a bio. The accessible name is the same string the
 * tooltip shows, so it is announced rather than skipped as decoration.
 */
export function AdminBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const px = size === 'md' ? 18 : 15;

  return (
    <span
      // `title` gives the hover tooltip, `aria-label` + role give it a name a
      // screen reader announces. Inline-flex keeps it on the name's baseline
      // rather than dropping it to the next line when the name wraps.
      title={ADMIN_BADGE_LABEL}
      aria-label={ADMIN_BADGE_LABEL}
      role="img"
      data-admin-badge="true"
      className="relative inline-flex shrink-0 translate-y-[1px] items-center justify-center align-middle"
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          {/* FayTarra's own gradient, the same three stops as the logo. */}
          <linearGradient id="fay-admin-badge" x1="0" y1="24" x2="24" y2="0">
            <stop offset="0%" stopColor="#7C5CFF" />
            <stop offset="52%" stopColor="#FF3D9A" />
            <stop offset="100%" stopColor="#FFB443" />
          </linearGradient>
        </defs>
        <path
          d="M12 2.2 20 5.2v6.1c0 4.7-3.2 8.9-8 10.5-4.8-1.6-8-5.8-8-10.5V5.2l8-3Z"
          fill="url(#fay-admin-badge)"
        />
        <path
          d="m8.4 12.1 2.5 2.5 4.7-4.9"
          stroke="#06060A"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
