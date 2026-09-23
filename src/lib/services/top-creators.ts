import 'server-only';
import { db, isMissingRelation } from '@/lib/db';
import type { ID, PublicUser } from '@/lib/types';
import { refreshCommunity } from './community-cache';
import { hiddenUserIds, toPublicUser } from './users';

/**
 * Somebody's three favourite creators.
 *
 * A personal pick, not a ranking. Nothing in here reads a rating, a follower
 * count or a recommendation score — the only inputs are who this person
 * follows and, if they have said so, which three of them they chose and in
 * what order.
 *
 * There is no second list of people anywhere: a slot is an account id, looked
 * up in `users` when the profile renders, exactly as the followers list does.
 * Which is also what keeps it honest when somebody changes their @handle.
 */

export const TOP_SLOTS = 3;

export interface TopCreatorSlot {
  position: number;
  person: PublicUser | null;
}

export interface TopCreators {
  slots: TopCreatorSlot[];
  /** True once this person has chosen for themselves. */
  chosen: boolean;
}

/** Everyone this person follows, in the order they followed them. */
export async function followedInOrder(userId: ID): Promise<ID[]> {
  const rows = await db().query('follows', { where: { follower_id: userId } });
  return [...rows]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((row) => row.following_id);
}

/** The stored choice, if the column exists and anything is in it. */
function storedChoice(user: { top_creators?: string[] | null } | null): ID[] | null {
  const stored = user?.top_creators;
  if (!Array.isArray(stored) || stored.length === 0) return null;
  return stored.filter((id): id is string => typeof id === 'string').slice(0, TOP_SLOTS);
}

/**
 * The Top 3 to show on a profile.
 *
 * Until somebody picks, it is the first three accounts they followed, in that
 * order — which is a default that cannot go stale, because it is derived from
 * the follow graph rather than written down at the moment they followed their
 * third person. A fourth follow therefore never displaces anybody.
 *
 * Once they have picked, it is their list, filtered to the people they still
 * follow. Unfollowing somebody empties their slot rather than quietly
 * promoting whoever is next: the slot is theirs to fill again.
 */
export async function topCreators(userId: ID, viewerId: ID | null): Promise<TopCreators> {
  const store = db();
  const [user, following, hidden] = await Promise.all([
    store.get('users', userId),
    followedInOrder(userId),
    hiddenUserIds(viewerId),
  ]);

  const follows = new Set(following);
  const chosen = storedChoice(user);
  const ids = chosen
    ? chosen.filter((id) => follows.has(id))
    : following.slice(0, TOP_SLOTS);

  const people = ids.length > 0 ? await store.query('users', { in: { id: ids } }) : [];
  const byId = new Map(people.map((person) => [person.id, person]));

  const slots: TopCreatorSlot[] = [];
  for (let index = 0; index < TOP_SLOTS; index += 1) {
    const id = ids[index];
    const person = id ? byId.get(id) : undefined;
    // A banned account, or one the viewer has blocked, leaves the slot empty
    // rather than the profile showing somebody nobody else can see.
    const visible = person && person.status !== 'banned' && !hidden.has(person.id);
    slots.push({ position: index + 1, person: visible ? toPublicUser(person) : null });
  }

  return { slots, chosen: chosen !== null };
}

export type SaveResult =
  | { ok: true }
  | { ok: false; error: string };

export const TOP_CREATORS_UNAVAILABLE =
  'Choosing your Top 3 is not switched on for this deployment yet.';

/**
 * Stores somebody's choice.
 *
 * Every id has to be an account they currently follow — that is the only rule,
 * and it is checked here rather than trusted from the form. There is
 * deliberately no mutual-follow requirement: following somebody is enough to
 * put them in your Top 3, and they never have to follow back.
 *
 * Returns false-ish with a reason when the column is not there, so a
 * deployment that has not run migration 0006 keeps showing the default Top 3
 * and simply cannot change it. Any other failure throws.
 */
export async function saveTopCreators(userId: ID, ids: ID[]): Promise<SaveResult> {
  const unique: ID[] = [];
  for (const id of ids) {
    if (id && id !== userId && !unique.includes(id)) unique.push(id);
  }
  const trimmed = unique.slice(0, TOP_SLOTS);

  const follows = new Set(await followedInOrder(userId));
  const notFollowed = trimmed.find((id) => !follows.has(id));
  if (notFollowed) {
    return { ok: false, error: 'You can only pick people you follow.' };
  }

  try {
    await db().update('users', userId, { top_creators: trimmed } as never);
    refreshCommunity();
    return { ok: true };
  } catch (error) {
    if (isMissingRelation(error) && error.table === 'users' && error.column !== null) {
      if (!warned) {
        warned = true;
        console.error(
          '[faytarra] Top 3 creators cannot be changed: this database has no `top_creators` ' +
            'column on `users`. Run supabase/migrations/0006_top_creators.sql against it. ' +
            'Profiles still show the default Top 3 — the first three accounts each person ' +
            `followed. (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      return { ok: false, error: TOP_CREATORS_UNAVAILABLE };
    }
    throw error;
  }
}

let warned = false;

/** The people somebody may choose from: everyone they follow, newest first. */
export async function eligibleCreators(userId: ID): Promise<PublicUser[]> {
  const ids = await followedInOrder(userId);
  if (ids.length === 0) return [];
  const people = await db().query('users', { in: { id: ids } });
  const byId = new Map(people.map((person) => [person.id, person]));
  const out: PublicUser[] = [];
  for (const id of [...ids].reverse()) {
    const person = byId.get(id);
    if (person && person.status !== 'banned') out.push(toPublicUser(person));
  }
  return out;
}
