import Link from 'next/link';
import { Avatar } from './Avatar';
import { TopCreatorsEditor } from './TopCreatorsEditor';
import type { TopCreatorSlot } from '@/lib/services/top-creators';
import type { PublicUser } from '@/lib/types';

/**
 * Somebody's three favourite creators.
 *
 * A little of the old profile-page spirit — a numbered list of people you
 * wanted everyone to see — built out of the same card, chip and avatar this
 * profile is already made of, and sized to sit under the rating without
 * competing with it.
 *
 * Every name and every picture is a link to that person. The numbers mean the
 * order the owner put them in and nothing else: no rating, no follower count
 * and no recommendation score is read anywhere near this.
 */
export function TopCreators({
  slots,
  owner,
  canEdit,
  options,
}: {
  slots: TopCreatorSlot[];
  /** Whose profile this is, for the empty-state wording. */
  owner: string;
  canEdit: boolean;
  /** Everyone the owner follows. Only sent for their own profile. */
  options: { id: string; username: string; displayName: string; avatarUrl: string | null }[];
}) {
  const filled = slots.filter((slot) => slot.person !== null).length;

  return (
    <section className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <div className="flex items-center gap-2">
        <h2 className="label">Top creators</h2>
        <span className="text-[11px] text-white/30">picked by {canEdit ? 'you' : owner}</span>
        {canEdit && (
          <span className="ml-auto">
            <TopCreatorsEditor
              slots={slots.map((slot) => ({
                position: slot.position,
                id: slot.person?.id ?? null,
              }))}
              options={options}
            />
          </span>
        )}
      </div>

      {/* Three slots, always. An empty one is part of the shape of this
          section rather than something missing from it. */}
      <ol className="mt-3 space-y-2">
        {slots.map((slot) => (
          <li key={slot.position} className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] font-display text-[11px] font-bold tabular-nums"
            >
              {slot.position}
            </span>
            {slot.person ? (
              <Creator position={slot.position} person={slot.person} />
            ) : (
              <span className="text-sm text-white/30">
                {canEdit ? 'Empty — pick someone you follow' : 'Empty'}
              </span>
            )}
          </li>
        ))}
      </ol>

      {filled === 0 && (
        <p className="mt-3 text-[12px] leading-relaxed text-white/35">
          {canEdit
            ? 'The first three accounts you follow become your Top 3, until you pick your own.'
            : `${owner} has not picked a Top 3 yet.`}
        </p>
      )}
    </section>
  );
}

function Creator({ position, person }: { position: number; person: PublicUser }) {
  return (
    <>
      <Avatar
        username={person.username}
        displayName={person.display_name}
        src={person.avatar_url}
        size="xs"
        href={`/u/${person.username}`}
      />
      <Link
        href={`/u/${person.username}`}
        aria-label={`Number ${position}: ${person.display_name} (@${person.username})`}
        className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline"
      >
        {person.display_name}
        <span className="ml-1.5 truncate text-[12px] font-normal text-white/40">
          @{person.username}
        </span>
      </Link>
    </>
  );
}
