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
    <div className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      <Link href={basePath} className={`chip ${!active ? 'chip-active' : 'hover:bg-white/10'}`}>
        All
      </Link>
      {CATEGORIES.map((category) => (
        <Link
          key={category}
          href={`${basePath}?category=${encodeURIComponent(category)}`}
          className={`chip ${active === category ? 'chip-active' : 'hover:bg-white/10'}`}
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
