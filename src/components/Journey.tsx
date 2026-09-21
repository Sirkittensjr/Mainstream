import { formatMonthYear, formatShortDate } from '@/lib/time';
import type { Journey as JourneyData } from '@/lib/services/users';
import type { RankHistoryEntry } from '@/lib/services/rankings';
import { LevelMeter } from './LevelBadge';

/** "Tommy's FayTarra Journey" — the profile section that makes this feel like a path. */
export function Journey({
  name,
  journey,
  history = [],
}: {
  name: string;
  journey: JourneyData;
  history?: RankHistoryEntry[];
}) {
  return (
    <section className="card p-6">
      <h2 className="font-display text-xl font-bold">{name}&rsquo;s FayTarra Journey</h2>
      <p className="mt-1 text-sm text-white/45">Joined {formatMonthYear(journey.joined)}</p>

      <div className="mt-6">
        <p className="label">Followers</p>
        <ol className="mt-3 flex items-center">
          {journey.followerTrack.map((step, index) => (
            <li key={step.milestone} className="flex flex-1 items-center last:flex-none">
              <span
                className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-xs font-bold ${
                  step.reached
                    ? 'bg-gradient-to-br from-solar to-fay text-ink-950'
                    : 'border border-white/10 text-white/30'
                }`}
              >
                {step.milestone >= 1000 ? `${step.milestone / 1000}k` : step.milestone}
              </span>
              {index < journey.followerTrack.length - 1 && (
                <span
                  className={`mx-1 h-0.5 flex-1 rounded ${
                    journey.followerTrack[index + 1].reached ? 'bg-fay' : 'bg-white/10'
                  }`}
                />
              )}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-white/55">
          {journey.followers.toLocaleString()} now · next goal{' '}
          <span className="font-semibold text-white">
            {journey.nextGoal.toLocaleString()} followers
          </span>
        </p>
      </div>

      <ul className="mt-6 space-y-3">
        {journey.milestones.map((milestone) => (
          <li key={milestone.label} className="flex items-baseline gap-3">
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                milestone.done ? 'bg-mint' : 'bg-white/15'
              }`}
            />
            <span className="flex-1 text-sm text-white/60">{milestone.label}</span>
            <span className="text-sm font-semibold">{milestone.value}</span>
            {milestone.date && (
              <span className="w-16 text-right text-xs text-white/30">
                {formatShortDate(milestone.date)}
              </span>
            )}
          </li>
        ))}
      </ul>

      {history.length > 0 && (
        <div className="mt-6">
          <p className="label">Rank history</p>
          <ol className="mt-3 space-y-2">
            {history.map((entry, index) => {
              const previous = history[index - 1];
              const moved = previous ? previous.overallRank - entry.overallRank : 0;
              return (
                <li key={entry.period} className="flex items-baseline gap-3 text-sm">
                  <span className="w-24 shrink-0 text-white/45">{entry.label}</span>
                  <span className="font-display font-bold tabular-nums">
                    #{entry.overallRank.toLocaleString()}
                  </span>
                  {moved !== 0 && (
                    <span
                      className={`text-xs font-semibold ${moved > 0 ? 'text-mint' : 'text-fay-soft'}`}
                    >
                      {moved > 0 ? '▲' : '▼'} {Math.abs(moved).toLocaleString()}
                    </span>
                  )}
                  <span className="ml-auto text-xs tabular-nums text-white/35">
                    rating {entry.overallRating.toFixed(1)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="label">FayTarra level</p>
          <p className="text-xs text-white/40">
            Level {journey.level} — {journey.levelName} · {journey.points.toLocaleString()} pts
          </p>
        </div>
        <LevelMeter points={journey.points} />
      </div>
    </section>
  );
}
