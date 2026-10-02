import Link from 'next/link';
import { CATEGORIES } from '@/lib/types';

export function CategoryChips({
  basePath,
  active,
  counts,
}: {
  basePath: string;
  active: string | null;
  counts?: Map<string, number>;
}) {
  return (
    <div className="chip-strip">
      <Link
        href={basePath}
        aria-current={!active ? 'page' : undefined}
        className={`chip-tab ${!active ? 'chip-active' : 'hover:bg-white/10'}`}
      >
        All
      </Link>
      {CATEGORIES.map((category) => (
        <Link
          key={category}
          href={`${basePath}?category=${encodeURIComponent(category)}`}
          aria-current={active === category ? 'page' : undefined}
          className={`chip-tab ${active === category ? 'chip-active' : 'hover:bg-white/10'}`}
        >
          {category}
          {counts?.get(category) ? (
            <span className="text-[11px] opacity-50">{counts.get(category)}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
