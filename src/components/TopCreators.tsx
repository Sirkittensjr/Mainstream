import Link from 'next/link';
import { Avatar } from './Avatar';
import { TopCreatorsEditor } from './TopCreatorsEditor';
import type { TopCreatorSlot } from '@/lib/services/top-creators';
import type { PublicUser } from '@/lib/types';

/**
 * Somebody's three favourite creators.
 *
 * A little of the old profile-page spirit — three people you wanted everyone
 * to see, side by side and numbered — built out of the same card, chip and
 * avatar this profile is already made of, and sized to sit under the rating
 * without competing with it.
 *
 * Three equal columns at every width. Thirds of a phone-width card are about
 * a hundred points across, which a 44pt picture and a truncated name fit
 * inside comfortably, so there is nothing to scroll sideways and no separate
 * mobile arrangement to keep in step with this one.
 *
 * Each column is one link covering the number, the picture and the name, so
 * the whole tile is the tap target rather than a 44pt circle next to some
 * text. The numbers mean the order the owner put them in and nothing else: no
 * rating, no follower count and no recommendation score is read anywhere near
 * this.
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
      <ol className="mt-3 grid grid-cols-3 gap-2">
        {slots.map((slot) => (
          <li key={slot.position} className="min-w-0">
            {slot.person ? (
              <Creator position={slot.position} person={slot.person} />
            ) : (
              <span className="flex flex-col items-center gap-1.5 px-1 py-1.5 text-center">
                <Position n={slot.position} />
                <span
                  aria-hidden
                  className="h-11 w-11 rounded-full border border-dashed border-white/20"
                />
                <span className="w-full truncate text-[12px] text-white/30">
                  {canEdit ? 'Pick someone' : 'Empty'}
                </span>
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
    <Link
      href={`/u/${person.username}`}
      aria-label={`Number ${position}: ${person.display_name} (@${person.username})`}
      className="group flex flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 text-center transition hover:bg-white/[0.05]"
    >
      <Position n={position} />
      {/* The picture is inside the tile's own link rather than carrying one of
          its own: an anchor cannot hold another anchor. */}
      <Avatar
        username={person.username}
        displayName={person.display_name}
        src={person.avatar_url}
        size="md"
        href={false}
      />
      <span className="w-full truncate text-[13px] font-semibold leading-tight group-hover:underline">
        {person.display_name}
      </span>
      <span className="w-full truncate text-[11px] leading-tight text-white/40">
        @{person.username}
      </span>
    </Link>
  );
}

/** The 1, 2 or 3 above a slot. */
function Position({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08] font-display text-[10px] font-bold tabular-nums"
    >
      {n}
    </span>
  );
}
