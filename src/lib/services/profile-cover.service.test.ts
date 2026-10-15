/**
 * A profile's background photo and colours, saved and read back through the
 * real services and a real (throwaway) local store.
 *
 * The photo and the colours are separate choices with separate saves: changing
 * one must never touch the other, and a background somebody already has must
 * come back exactly as it was saved.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it, mock } from 'node:test';

mock.module('next/cache', {
  namedExports: {
    revalidateTag: () => undefined,
    revalidatePath: () => undefined,
    unstable_cache: <T,>(fn: T) => fn,
  },
});

// Before anything touches the store: it picks its directory when it loads.
const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-cover-'));
process.env.FAYTARRA_DATA_DIR = dataDir;

let store: ReturnType<typeof import('@/lib/db').db>;
let users: typeof import('./users');
let media: typeof import('@/lib/media');

/** What the profile page shows for a saved background (src/app/(app)/u/[username]/page.tsx). */
const shown = (saved: string | null | undefined) => {
  const url = media.sanitiseAvatarUrl(saved);
  return url && media.mediaKindForUrl(url) === 'image' ? url : null;
};

const EXISTING = '/api/media/existing-cover.jpg';

function person(username: string, appearance: Record<string, string | null>) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    email: `${username}@example.com`,
    username,
    display_name: username,
    bio: '',
    avatar_url: null as string | null,
    location: null,
    interests: [],
    role: 'user' as const,
    status: 'active' as const,
    status_reason: null,
    trusted: false,
    username_changed_at: null,
    created_at: now,
    last_active_at: now,
    ...appearance,
  };
}

// Somebody who chose a photo, a gradient and a box colour before this test ran.
const ada = person('ada', { profile_cover_url: EXISTING, profile_bg: 'fay-aurora', profile_box: 'blue' });
const ben = person('ben', { profile_cover_url: null, profile_bg: null, profile_box: null });

const appearance = async (id: string) => {
  const row = await store.get('users', id);
  return { cover: row?.profile_cover_url ?? null, bg: row?.profile_bg ?? null, box: row?.profile_box ?? null };
};

before(async () => {
  users = await import('./users');
  media = await import('@/lib/media');
  store = (await import('@/lib/db')).db();
  for (const each of [ada, ben]) await store.insert('users', each);
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe('profile background photos', () => {
  it('an existing background is read back exactly as it was saved, and is shown', async () => {
    const user = await users.getUserByUsername('ada');
    assert.equal(user?.profile_cover_url, EXISTING);
    assert.equal(user?.profile_bg, 'fay-aurora');
    assert.equal(user?.profile_box, 'blue');
    assert.equal(shown(user?.profile_cover_url), EXISTING);
  });

  it('saving a new photo replaces the photo and nothing else', async () => {
    const next = '/api/media/new-cover.png';
    assert.deepEqual(await users.updateProfileCover(ada.id, next), { ok: true });
    assert.deepEqual(await appearance(ada.id), { cover: next, bg: 'fay-aurora', box: 'blue' });
  });

  it('changing the colours leaves the photo where it is', async () => {
    const before = (await appearance(ada.id)).cover;
    assert.deepEqual(await users.updateProfileColours(ada.id, 'red', 'black'), { ok: true });
    assert.deepEqual(await appearance(ada.id), { cover: before, bg: 'red', box: 'black' });
  });

  it("one person's save never touches anybody else's background", async () => {
    await users.updateProfileCover(ben.id, '/api/media/bens.jpg');
    assert.equal((await appearance(ada.id)).bg, 'red');
    assert.notEqual((await appearance(ada.id)).cover, '/api/media/bens.jpg');
    assert.deepEqual(await appearance(ben.id), { cover: '/api/media/bens.jpg', bg: null, box: null });
  });

  it('removing the photo goes back to the colours, which are kept', async () => {
    assert.deepEqual(await users.updateProfileCover(ada.id, null), { ok: true });
    assert.deepEqual(await appearance(ada.id), { cover: null, bg: 'red', box: 'black' });
    assert.equal(shown((await users.getUserByUsername('ada'))?.profile_cover_url), null);
  });
});
