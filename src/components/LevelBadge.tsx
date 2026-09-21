import { LEVELS, levelProgress, nextLevel, pointsToNextLevel } from '@/lib/progression';

export function LevelBadge({
  level,
  name,
  size = 'sm',
}: {
  level: number;
  name?: string;
  size?: 'xs' | 'sm' | 'md';
}) {
  const label = name ?? LEVELS[level - 1]?.name ?? 'Rookie';
  const classes =
    size === 'xs'
      ? 'px-2 py-0.5 text-[10px]'
      : size === 'md'
        ? 'px-3 py-1 text-xs'
        : 'px-2.5 py-0.5 text-[11px]';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-fay/30 bg-fay/10 font-semibold uppercase tracking-wide text-fay-soft ${classes}`}
      title={`Level ${level} — ${label}`}
    >
      <span className="text-white/80">L{level}</span>
      {label}
    </span>
  );
}

/** The progress bar shown on profiles and in the FayTarra panel. */
export function LevelMeter({ points, compact = false }: { points: number; compact?: boolean }) {
  const progress = levelProgress(points);
  const next = nextLevel(points);
  return (
    <div className="w-full">
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full animate-level-bar rounded-full"
          style={{
            width: `${progress}%`,
            backgroundImage: 'linear-gradient(90deg,#FFB443,#FF3D9A)',
          }}
        />
      </div>
      {!compact && (
        <p className="mt-2 text-xs text-white/50">
          {next
            ? `${pointsToNextLevel(points).toLocaleString()} points to Level ${next.level} — ${next.name}`
            : 'Max level. You are an Icon.'}
        </p>
      )}
    </div>
  );
}
