'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Renders its children everywhere except your own profile and its lists.
 *
 * The desktop rail shows your profile card and your Top 3. On your own profile
 * the page itself is exactly those things, at full size, so the rail repeating
 * them beside it is the same card twice — and two links to the same follower
 * list. Nothing is rendered there at all, rather than hidden, so the page has
 * one of each.
 */
export function UnlessOwnProfile({ username, children }: { username: string; children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const own = `/u/${username}`.toLowerCase();
  const here = pathname.toLowerCase();
  if (here === own || here.startsWith(`${own}/`)) return null;
  return <>{children}</>;
}
