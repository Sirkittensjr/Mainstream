import Link from 'next/link';

/**
 * Paging that works as a plain link.
 *
 * The feeds used to stop dead at their first page with nothing after them, so
 * anyone who scrolled to the bottom had simply run out of FayTarra. This grows
 * the page server-side: no client state, no infinite-scroll machinery, and it
 * still works if JavaScript has not loaded yet.
 */
export function LoadMore({
  href,
  hasMore,
  label = 'Show more',
  endNote,
}: {
  href: string;
  hasMore: boolean;
  label?: string;
  endNote?: React.ReactNode;
}) {
  if (!hasMore) {
    return endNote ? (
      <p className="py-10 text-center text-xs text-white/25">{endNote}</p>
    ) : null;
  }
  return (
    <div className="flex justify-center py-8">
      <Link href={href} scroll={false} className="btn-ghost px-8 py-3 text-sm">
        {label}
      </Link>
    </div>
  );
}
