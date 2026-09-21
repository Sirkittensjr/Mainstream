import { formatRating, ratingTone, TREND_ARROW, type Trend } from '@/lib/ratings';

const TONE = {
  high: 'border-mint/40 bg-mint/10 text-mint',
  good: 'border-fay/40 bg-fay/10 text-fay-soft',
  mid: 'border-solar/35 bg-solar/10 text-solar',
  low: 'border-white/15 bg-white/[0.05] text-white/60',
  none: 'border-dashed border-white/15 bg-transparent text-white/35',
} as const;

const SIZES = {
  sm: 'px-2 py-0.5 text-[12px]',
  md: 'px-2.5 py-1 text-[13px]',
  lg: 'px-3 py-1.5 text-base',
} as const;

/** The number that answers "how is this doing?" — used on posts and profiles. */
export function RatingPill({
  value,
  label,
  trend,
  size = 'md',
  count,
}: {
  value: number | null;
  label?: string;
  trend?: Trend;
  size?: keyof typeof SIZES;
  count?: number;
}) {
  const tone = TONE[ratingTone(value)];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-display font-bold tabular-nums ${tone} ${SIZES[size]}`}
      title={count != null ? `${count} rating${count === 1 ? '' : 's'}` : undefined}
    >
      {label && <span className="font-sans text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</span>}
      {formatRating(value)}
      {trend && trend !== 'steady' && (
        <span aria-label={trend === 'up' ? 'rising' : 'falling'}>{TREND_ARROW[trend]}</span>
      )}
    </span>
  );
}

/** Distribution bar used on the post page. */
export function ReactionBar({
  reactions,
}: {
  reactions: { reaction: string; count: number }[];
}) {
  const shown = reactions.filter((entry) => entry.count > 0);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((entry) => (
        <span key={entry.reaction} className="chip text-[12px]">
          {entry.reaction} <span className="text-white/40">{entry.count}</span>
        </span>
      ))}
    </div>
  );
}
