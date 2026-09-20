import { formatMonthYear, formatShortDate } from '@/lib/time';
import type { Journey as JourneyData } from '@/lib/services/users';
import { RiseMeter } from './LevelBadge';

/** "Tommy's RISE Journey" — the profile section that makes this feel like a path. */
export function Journey({ name, journey }: { name: string; journey: JourneyData }) {
  return (
    <section className="card p-6">
      <h2 className="font-display text-xl font-bold">{name}&rsquo;s RISE Journey</h2>
      <p className="mt-1 text-sm text-white/45">Joined {formatMonthYear(journey.joined)}</p>

      <div className="mt-6">
        <p className="label">Followers</p>
        <ol className="mt-3 flex items-center">
          {journey.followerTrack.map((step, index) => (
            <li key={step.milestone} className="flex flex-1 items-center last:flex-none">
              <span
                className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-xs font-bold ${
                  step.reached
                    ? 'bg-gradient-to-br from-solar to-ember text-ink-950'
                    : 'border border-white/10 text-white/30'
                }`}
              >
                {step.milestone >= 1000 ? `${step.milestone / 1000}k` : step.milestone}
              </span>
              {index < journey.followerTrack.length - 1 && (
                <span
                  className={`mx-1 h-0.5 flex-1 rounded ${
                    journey.followerTrack[index + 1].reached ? 'bg-ember' : 'bg-white/10'
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

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="label">RISE level</p>
          <p className="text-xs text-white/40">
            Level {journey.level} — {journey.levelName} · {journey.points.toLocaleString()} pts
          </p>
        </div>
        <RiseMeter points={journey.points} />
      </div>
    </section>
  );
}
