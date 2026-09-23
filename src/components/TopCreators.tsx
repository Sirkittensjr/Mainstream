import Link from 'next/link';
import { Avatar } from './Avatar';
import { TopCreatorsEditor } from './TopCreatorsEditor';
import type { TopCreatorSlot } from '@/lib/services/top-creators';
import type { PublicUser } from '@/lib/types';

/**
 * Somebody's three favourite creators.
 *
 * A little of the old profile-page spirit — three people you wanted everyone
 * to see, side by side and numbered — sized to sit under the rating without
 * competing with it.
 *
 * Three equal columns at every width. Thirds of a phone-width card are about
 * a hundred points across, which a 44pt picture and a truncated name fit
 * inside comfortably, so there is nothing to scroll sideways and no separate
 * mobile arrangement to keep in step with this one.
 *
 * Each card is one link covering the number, the picture and the name, so the
 * whole thing is the tap target rather than a 44pt circle next to some text.
 * The numbers mean the order the owner put them in and nothing else: no
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
      <ol className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2">
        {slots.map((slot) => (
          <li key={slot.position} className="min-w-0">
            {slot.person ? (
              <Creator position={slot.position} person={slot.person} />
            ) : (
              <EmptySlot position={slot.position} canEdit={canEdit} />
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

/**
 * First, second and third, in metal.
 *
 * Every colour here is an inline style rather than a utility class, and that
 * is the point rather than an oversight. A profile painted in its owner's
 * colours restyles the utilities inside it — `.profile-skin` repaints
 * anything asking for `text-white/…` or `bg-white/…` so the boxes stay
 * readable in yellow or in purple. These three cards have to survive that
 * untouched, so they bring their own surface, their own border and their own
 * ink, and an inline style outranks the skin's rules.
 *
 * The surfaces are opaque and dark on purpose: whatever the profile behind
 * them is painted, the picture and the name sit on the same metal and stay
 * readable. The treatment is a gradient, a rim and a soft glow — no medals,
 * no trophies, nothing to compete with the face in the middle of the card.
 */
const MEDALS = {
  1: {
    label: 'gold',
    surface: 'linear-gradient(155deg, #8C6115 0%, #3A2709 44%, #1C1307 100%)',
    rim: 'rgba(252, 220, 133, 0.92)',
    glow:
      'inset 0 1px 0 rgba(255, 241, 205, 0.34), inset 0 -10px 24px -14px rgba(255, 219, 140, 0.55), ' +
      '0 0 0 1px rgba(252, 220, 133, 0.20), 0 12px 30px -12px rgba(233, 186, 73, 0.95)',
    chip: 'linear-gradient(145deg, #FFF3CC 0%, #EFC559 50%, #A8791A 100%)',
    chipInk: '#2C1E02',
    sheen: 'rgba(255, 234, 178, 0.22)',
  },
  2: {
    label: 'silver',
    surface: 'linear-gradient(155deg, #5A6270 0%, #2A2E36 44%, #16181D 100%)',
    rim: 'rgba(235, 240, 249, 0.85)',
    glow:
      'inset 0 1px 0 rgba(255, 255, 255, 0.36), inset 0 -10px 24px -14px rgba(226, 234, 246, 0.45), ' +
      '0 0 0 1px rgba(235, 240, 249, 0.18), 0 12px 30px -12px rgba(201, 210, 222, 0.85)',
    chip: 'linear-gradient(145deg, #FFFFFF 0%, #CDD6E2 50%, #8A94A3 100%)',
    chipInk: '#1B1E24',
    sheen: 'rgba(240, 246, 255, 0.20)',
  },
  3: {
    label: 'bronze',
    surface: 'linear-gradient(155deg, #85481A 0%, #3A210D 44%, #1D1309 100%)',
    rim: 'rgba(238, 170, 108, 0.85)',
    glow:
      'inset 0 1px 0 rgba(255, 219, 184, 0.30), inset 0 -10px 24px -14px rgba(236, 165, 105, 0.45), ' +
      '0 0 0 1px rgba(238, 170, 108, 0.18), 0 12px 30px -12px rgba(206, 139, 79, 0.9)',
    chip: 'linear-gradient(145deg, #F8D6B4 0%, #D4915A 50%, #8E5526 100%)',
    chipInk: '#2A1607',
    sheen: 'rgba(255, 210, 170, 0.18)',
  },
} as const;

type Place = keyof typeof MEDALS;

const medalFor = (position: number) => MEDALS[(position as Place) in MEDALS ? (position as Place) : 1];

function Creator({ position, person }: { position: number; person: PublicUser }) {
  const medal = medalFor(position);

  return (
    <Link
      href={`/u/${person.username}`}
      aria-label={`Number ${position}: ${person.display_name} (@${person.username})`}
      data-medal={medal.label}
      style={{
        backgroundImage: medal.surface,
        borderColor: medal.rim,
        boxShadow: medal.glow,
      }}
      className="group relative flex flex-col items-center gap-1.5 overflow-hidden rounded-2xl border px-1 py-2 text-center transition duration-200 hover:-translate-y-0.5 hover:brightness-110 sm:py-2.5"
    >
      {/* One diagonal highlight across the metal. Enough to catch the light;
          not enough to read as a graphic of its own. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            `linear-gradient(128deg, ${medal.sheen} 0%, transparent 36%), ` +
            `linear-gradient(118deg, transparent 40%, ${medal.sheen} 52%, transparent 66%)`,
        }}
      />
      <span
        aria-hidden
        className="relative flex h-5 w-5 items-center justify-center rounded-full font-display text-[10px] font-bold tabular-nums"
        style={{ backgroundImage: medal.chip, color: medal.chipInk }}
      >
        {position}
      </span>
      {/* The picture is inside the card's own link rather than carrying one of
          its own: an anchor cannot hold another anchor. */}
      <span
        className="relative rounded-full"
        style={{ boxShadow: `0 0 0 2px ${medal.rim}` }}
      >
        <Avatar
          username={person.username}
          displayName={person.display_name}
          src={person.avatar_url}
          size="md"
          href={false}
        />
      </span>
      <span
        className="relative w-full truncate px-1 text-[12.5px] font-semibold leading-tight group-hover:underline sm:text-[13px]"
        style={{ color: '#FFFFFF' }}
      >
        {person.display_name}
      </span>
      <span
        className="relative w-full truncate px-1 text-[11px] leading-tight"
        style={{ color: 'rgba(255, 255, 255, 0.55)' }}
      >
        @{person.username}
      </span>
    </Link>
  );
}

/**
 * A slot nobody is in yet.
 *
 * Same size and shape as a filled card so the row does not change height, and
 * the same trick with inline colours: it is dark enough to read on any profile
 * the owner has painted, without pretending to be a medal.
 */
function EmptySlot({ position, canEdit }: { position: number; canEdit: boolean }) {
  return (
    <span
      style={{
        backgroundColor: 'rgba(12, 12, 18, 0.72)',
        borderColor: 'rgba(255, 255, 255, 0.14)',
      }}
      className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed px-1 py-2 text-center sm:py-2.5"
    >
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded-full font-display text-[10px] font-bold tabular-nums"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.10)', color: 'rgba(255,255,255,0.7)' }}
      >
        {position}
      </span>
      <span
        aria-hidden
        className="h-11 w-11 rounded-full border border-dashed"
        style={{ borderColor: 'rgba(255, 255, 255, 0.22)' }}
      />
      <span
        className="w-full truncate px-1 text-[11px] leading-tight"
        style={{ color: 'rgba(255, 255, 255, 0.45)' }}
      >
        {canEdit ? 'Pick someone' : 'Empty'}
      </span>
      <span className="h-[13px]" aria-hidden />
    </span>
  );
}
