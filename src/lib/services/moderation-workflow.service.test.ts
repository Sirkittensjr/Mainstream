/**
 * Post moderation end to end through the services, against a throwaway local
 * store with real files on disk:
 *
 *   reporting and hiding · who may hide · the per-reporter limit · reports
 *   that arrive together · approving · restoring without re-hiding · keeping
 *   under review · dismissing without revealing what is still restricted ·
 *   removing permanently · warnings, suspensions and bans · the queue and the
 *   audit log
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-moderation-'));
process.env.FAYTARRA_DATA_DIR = dataDir;
const uploads = path.join(dataDir, 'uploads');

let store: ReturnType<typeof import('@/lib/db').db>;
let posts: typeof import('./posts');
let moderation: typeof import('./moderation');
let ratings: typeof import('./ratings');
let discovery: typeof import('./discovery');
let search: typeof import('./search');

type Status = 'active' | 'suspended' | 'banned';

function person(username: string, extra: { status?: Status; trusted?: boolean; role?: 'user' | 'admin' } = {}) {
  const long = new Date(Date.now() - 120 * 86_400_000).toISOString();
  return {
    id: crypto.randomUUID(),
    email: `${username}@example.com`,
    username,
    display_name: username,
    bio: '',
    avatar_url: null as string | null,
    location: null,
    interests: [],
    role: extra.role ?? ('user' as const),
    status: extra.status ?? ('active' as const),
    status_reason: null,
    trusted: extra.trusted ?? true,
    username_changed_at: null,
    created_at: long,
    last_active_at: long,
  };
}

const author = person('author');
const admin = person('admin', { role: 'admin' });
const otherAdmin = person('otheradmin', { role: 'admin' });
const viewer = person('viewer');
const benched = person('benched', { status: 'suspended' });
const flagged = person('flagged', { trusted: false });
const banned = person('banned', { status: 'banned' });
let made = 0;

/** A fresh, eligible reporter. */
async function reporter(name = `r${(made += 1)}`) {
  const account = person(`${name}_${crypto.randomUUID().slice(0, 6)}`);
  await store.insert('users', account);
  return account;
}

function file(extension = 'jpg'): string {
  mkdirSync(uploads, { recursive: true });
  const name = `${crypto.randomUUID()}.${extension}`;
  writeFileSync(path.join(uploads, name), 'bytes');
  return `/api/media/${name}`;
}
const onDisk = (url: string) => existsSync(path.join(uploads, path.basename(url)));

async function photo(caption = `a photo ${crypto.randomUUID().slice(0, 8)}`, url = file()) {
  return posts.createPost({ authorId: author.id, caption, category: 'Life', tags: [], media: [{ kind: 'image', url }] });
}

const report = (reporterId: string, postId: string, reason = 'Spam', details = '') =>
  moderation.submitReport({ reporterId, targetType: 'post', targetId: postId, reason, details });

const stateOf = async (postId: string) => {
  const row = await store.get('posts', postId);
  return { removed: row?.removed ?? null, review: row?.review_state ?? null };
};

/** Is it anywhere a member of the public would find it? */
async function publiclyVisible(postId: string, caption: string) {
  const [feed, profile, found, discover] = await Promise.all([
    posts.visiblePosts(viewer.id),
    posts.postsByAuthor(author.id, viewer),
    search.search(caption, viewer.id),
    discovery.discoverPosts({ board: 'top', viewerId: viewer.id, limit: 500 }),
  ]);
  return {
    feed: feed.some((post) => post.id === postId),
    profile: profile.some((post) => post.id === postId),
    search: found.posts.some((view) => view.post.id === postId),
    discover: discover.some((view) => view.post.id === postId),
  };
}

const events = async (postId: string, action?: string) =>
  (await store.query('moderation_events', { where: { target_id: postId } })).filter(
    (event) => !action || event.action === action,
  );

before(async () => {
  posts = await import('./posts');
  moderation = await import('./moderation');
  ratings = await import('./ratings');
  discovery = await import('./discovery');
  search = await import('./search');
  store = (await import('@/lib/db')).db();
  for (const each of [author, admin, otherAdmin, viewer, benched, flagged, banned]) {
    await store.insert('users', each);
  }
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

const THRESHOLD = 10;

/** `n` fresh eligible accounts each reporting the post, one after another. */
async function reportedBy(postId: string, n: number, reason = 'Spam') {
  const people = [];
  for (let i = 0; i < n; i += 1) {
    const someone = await reporter();
    people.push(someone);
    await report(someone.id, postId, reason);
  }
  return people;
}

describe('reports below the threshold: recorded, shown to admins, post stays up', () => {
  it('one to nine valid reports leave it visible and put it in the dashboard at once', async () => {
    const post = await photo('nine is not ten');
    for (let n = 1; n < THRESHOLD; n += 1) {
      const result = await report((await reporter()).id, post.id);
      assert.deepEqual(result, { ok: true, hidden: false }, `report ${n}`);
      const queue = await moderation.moderationQueue();
      const item = queue.reported.find((entry) => entry.post.id === post.id);
      assert.ok(item, `in the dashboard after report ${n}`);
      assert.equal(item.validReports, n);
      assert.equal(item.openReports, n);
    }
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    assert.deepEqual(await publiclyVisible(post.id, 'nine is not ten'), { feed: true, profile: true, search: true, discover: true });
  });
});

describe('the tenth valid report hides it pending admin review', () => {
  it('hidden everywhere the public looks, kept, and in the queue', async () => {
    const post = await photo('sunset over the harbour');
    await reportedBy(post.id, THRESHOLD - 1);
    assert.deepEqual(await report((await reporter()).id, post.id), { ok: true, hidden: true });

    assert.deepEqual(await publiclyVisible(post.id, 'harbour'), { feed: false, profile: false, search: false, discover: false });
    const row = await store.get('posts', post.id);
    assert.equal(row?.review_state, 'temporary_review');
    assert.equal(row?.review_expires_at ?? null, null, 'no expiry: it waits for an admin');
    assert.equal(row?.removed, false);
    assert.equal(onDisk(post.media[0].url), true, 'its file is kept');
    const queue = await moderation.moderationQueue();
    const item = queue.hidden.find((entry) => entry.post.id === post.id);
    assert.equal(item?.state, 'report_hold');
    assert.equal(item?.validReports, THRESHOLD);
  });

  it('its author and moderators still see it', async () => {
    const post = await photo();
    await reportedBy(post.id, THRESHOLD);
    assert.ok((await posts.postsByAuthor(author.id, author)).some((p) => p.id === post.id));
    assert.ok((await posts.postsByAuthor(author.id, admin)).some((p) => p.id === post.id));
  });

  it('is logged, and the author is told it is temporarily hidden, without being told who', async () => {
    const post = await photo();
    const people = await reportedBy(post.id, THRESHOLD, 'Harassment');
    const [hide] = await events(post.id, 'auto_review_started');
    assert.equal(hide.actor_id, null);
    assert.equal(hide.unique_reports, THRESHOLD);
    const told = (await store.query('notifications', { where: { user_id: author.id, post_id: post.id } }))[0];
    assert.match(told.body, /temporarily hidden pending review/i);
    for (const someone of people) assert.ok(!told.body.includes(someone.username));
  });

  it('an eleventh report does not hide it again', async () => {
    const post = await photo();
    await reportedBy(post.id, THRESHOLD);
    assert.deepEqual(await report((await reporter()).id, post.id), { ok: true, hidden: false });
    assert.equal((await events(post.id, 'auto_review_started')).length, 1);
  });

  it('it survives a restart: the state is written to the store, not kept in memory', async () => {
    const post = await photo();
    await reportedBy(post.id, THRESHOLD);
    const { readFileSync } = await import('node:fs');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const saved = JSON.parse(readFileSync(path.join(dataDir, 'faytarra.json'), 'utf8'));
    assert.equal(saved.posts.find((p: { id: string }) => p.id === post.id).review_state, 'temporary_review');
  });

  it('a post already held, or removed, is never hidden again by reports', async () => {
    const held = await photo();
    await moderation.keepUnderReview(held.id, admin.id, 'looking');
    await reportedBy(held.id, THRESHOLD);
    assert.deepEqual(await stateOf(held.id), { removed: false, review: 'admin_hold' });
    assert.equal((await events(held.id, 'auto_review_started')).length, 0);
  });
});

describe('only valid reports count', () => {
  it('suspended, flagged and banned accounts never make up the tenth', async () => {
    const post = await photo();
    await reportedBy(post.id, THRESHOLD - 1);
    assert.deepEqual(await report(benched.id, post.id), { ok: true, hidden: false });
    assert.deepEqual(await report(flagged.id, post.id), { ok: true, hidden: false });
    assert.equal((await report(banned.id, post.id)).ok, false);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    assert.equal(await moderation.validReportCount(post.id), THRESHOLD - 1);
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, THRESHOLD + 1, 'still recorded');
  });

  it('a duplicate from the same account adds nothing, even sent five times at once', async () => {
    const post = await photo();
    const someone = await reporter();
    const results = await Promise.all(Array.from({ length: 5 }, () => report(someone.id, post.id)));
    assert.ok(results.every((result) => result.ok));
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, 1);
    assert.equal(await moderation.validReportCount(post.id), 1);
  });

  it('reporting again keeps one row, and the earlier wording is in the log', async () => {
    const post = await photo();
    const someone = await reporter();
    await report(someone.id, post.id, 'Spam', 'first');
    await report(someone.id, post.id, 'Harassment', 'second');
    const rows = await store.query('reports', { where: { target_id: post.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, 'Harassment');
    const [refiled] = await events(post.id, 'report_refiled');
    assert.match(refiled.detail, /Spam/);
    assert.match(refiled.detail, /first/);
  });
});

describe('reports arriving together', () => {
  it('ten different accounts at once hide it exactly once', async () => {
    const post = await photo();
    const people = await Promise.all(Array.from({ length: THRESHOLD }, () => reporter()));
    const results = await Promise.all(people.map((someone) => report(someone.id, post.id)));
    assert.ok(results.every((result) => result.ok));
    assert.equal(results.filter((result) => result.ok && result.hidden).length, 1);
    assert.equal((await events(post.id, 'auto_review_started')).length, 1);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'temporary_review' });
  });

  it('nine accounts plus a burst of duplicates and ineligible reports does not get there', async () => {
    const post = await photo();
    const people = await Promise.all(Array.from({ length: THRESHOLD - 1 }, () => reporter()));
    await Promise.all([
      ...people.map((someone) => report(someone.id, post.id)),
      ...people.map((someone) => report(someone.id, post.id)),
      report(benched.id, post.id),
      report(flagged.id, post.id),
    ]);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    assert.equal(await moderation.validReportCount(post.id), THRESHOLD - 1);
  });
});

describe('a hidden post stays hidden until an admin decides', () => {
  it('no clock brings it back, and dismissing reports does not either', async () => {
    const post = await photo();
    await reportedBy(post.id, THRESHOLD);
    // A day and more passes.
    await store.update('posts', post.id, { review_started_at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'temporary_review' });
    assert.equal((await posts.visiblePosts(viewer.id)).some((p) => p.id === post.id), false);
    for (const row of await store.query('reports', { where: { target_id: post.id } })) {
      await moderation.dismissReport(row.id, admin.id, 'unfounded');
    }
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'temporary_review' }, 'still hidden');
  });
});

describe('approve and restore', () => {
  it('brings it back with every like, comment and rating it had, and tells the author', async () => {
    const post = await photo('worth keeping');
    const fan = await reporter('fan');
    await posts.toggleLike(post.id, fan.id);
    await posts.addComment(post.id, fan.id, 'love this');
    const rated = await ratings.submitRating({ raterId: fan.id, targetType: 'post', targetId: post.id, score: 9, reactions: [] });
    assert.ok(rated.ok);

    await reportedBy(post.id, THRESHOLD);
    assert.deepEqual(await moderation.approvePost(post.id, admin.id, 'not spam'), { ok: true });

    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    assert.deepEqual(await publiclyVisible(post.id, 'worth keeping'), { feed: true, profile: true, search: true, discover: true });
    assert.equal((await store.query('likes', { where: { post_id: post.id } })).length, 1);
    assert.equal((await store.query('comments', { where: { post_id: post.id } })).length, 1);
    assert.equal((await store.query('ratings', { where: { target_id: post.id } })).length, 1);
    const [approved] = await events(post.id, 'admin_approved');
    assert.equal(approved.actor_id, admin.id);
    const told = await store.query('notifications', { where: { user_id: author.id, post_id: post.id } });
    assert.ok(told.some((note) => /visible again/i.test(note.body)));
  });

  it('clears its reports: the same people reporting again cannot hide it', async () => {
    const post = await photo();
    const people = await reportedBy(post.id, THRESHOLD);
    await moderation.approvePost(post.id, admin.id);
    for (const someone of people) assert.deepEqual(await report(someone.id, post.id), { ok: true, hidden: false });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    assert.equal(await moderation.validReportCount(post.id), 0);
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, THRESHOLD, 'history kept, not duplicated');
  });
});

describe('deny — keep removed', () => {
  it('needs a reason', async () => {
    const post = await photo();
    await reportedBy(post.id, THRESHOLD);
    assert.equal((await moderation.denyPost(post.id, admin.id, ' ')).ok, false);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'temporary_review' });
  });

  it('keeps it out of public view without deleting it, logs it and tells the author why', async () => {
    const post = await photo('deny this');
    await reportedBy(post.id, THRESHOLD);
    assert.deepEqual(await moderation.denyPost(post.id, admin.id, 'Graphic content'), { ok: true });
    const row = await store.get('posts', post.id);
    assert.equal(row?.removed, true);
    assert.equal(row?.removed_reason, 'Graphic content');
    assert.equal(onDisk(post.media[0].url), true, 'not deleted: its file stays');
    assert.deepEqual(await publiclyVisible(post.id, 'deny this'), { feed: false, profile: false, search: false, discover: false });
    const [denied] = await events(post.id, 'admin_denied');
    assert.equal(denied.actor_id, admin.id);
    assert.match(denied.detail, /Graphic content/);
    const told = await store.query('notifications', { where: { user_id: author.id, post_id: post.id } });
    assert.ok(told.some((note) => /Reason: Graphic content/.test(note.body)));
    // Still reversible.
    assert.deepEqual(await moderation.approvePost(post.id, admin.id, 'on appeal'), { ok: true });
    assert.equal((await store.get('posts', post.id))?.removed, false);
  });
});

describe('remove from public viewing (the ••• menu)', () => {
  it('needs a reason', async () => {
    const post = await photo();
    assert.equal((await moderation.hideFromPublic(post.id, admin.id, '')).ok, false);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
  });

  it('hides it everywhere at once, keeps everything, logs the details, tells the author why', async () => {
    const post = await photo('menu removal');
    const fan = await reporter();
    await posts.addComment(post.id, fan.id, 'hi');
    assert.deepEqual(await moderation.hideFromPublic(post.id, admin.id, 'Misleading'), { ok: true });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'admin_hold' });
    assert.deepEqual(await publiclyVisible(post.id, 'menu removal'), { feed: false, profile: false, search: false, discover: false });
    assert.equal(onDisk(post.media[0].url), true);
    assert.equal((await store.query('comments', { where: { post_id: post.id } })).length, 1);
    const [logged] = await events(post.id, 'admin_hidden');
    assert.equal(logged.actor_id, admin.id);
    assert.match(logged.detail, /Misleading/);
    assert.match(logged.detail, /menu removal/);
    assert.match(logged.detail, new RegExp(author.username));
    const told = await store.query('notifications', { where: { user_id: author.id, post_id: post.id } });
    assert.ok(told.some((note) => /removed from public viewing.*Reason: Misleading/.test(note.body)));
  });

  it('puts it in the queue, where an admin can restore it', async () => {
    const post = await photo();
    await moderation.hideFromPublic(post.id, admin.id, 'Checking');
    const queue = await moderation.moderationQueue();
    assert.equal(queue.hidden.find((entry) => entry.post.id === post.id)?.state, 'admin_hold');
    await moderation.approvePost(post.id, admin.id, 'fine');
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
  });

  it('is refused on a post already removed or already held', async () => {
    const post = await photo();
    await moderation.hideFromPublic(post.id, admin.id, 'Checking');
    assert.equal((await moderation.hideFromPublic(post.id, admin.id, 'again')).ok, false);
    const gone = await photo();
    await moderation.removePostPermanently(gone.id, admin.id, 'Spam');
    assert.equal((await moderation.hideFromPublic(gone.id, admin.id, 'late')).ok, false);
  });
});

describe('keep under review', () => {
  it('holds it hidden; dismissing every report does not reveal it; approval does', async () => {
    const post = await photo();
    await reportedBy(post.id, THRESHOLD);
    assert.deepEqual(await moderation.keepUnderReview(post.id, admin.id, 'checking with the author'), { ok: true });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'admin_hold' });
    for (const row of await store.query('reports', { where: { target_id: post.id } })) {
      await moderation.dismissReport(row.id, admin.id, 'unfounded');
    }
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'admin_hold' }, 'still held');
    await moderation.approvePost(post.id, admin.id);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
  });
});

describe('dismissing a report', () => {
  it('closes it, logs it, and is refused the second time', async () => {
    const post = await photo();
    await report((await reporter()).id, post.id);
    const [row] = await store.query('reports', { where: { target_id: post.id } });
    const both = await Promise.all([moderation.dismissReport(row.id, admin.id), moderation.dismissReport(row.id, admin.id)]);
    assert.equal(both.filter((result) => result.ok).length, 1);
    assert.equal((await store.get('reports', row.id))?.status, 'dismissed');
    assert.equal(await moderation.validReportCount(post.id), 0, 'a dismissed report no longer counts');
  });
});

describe('remove permanently', () => {
  it('needs a reason', async () => {
    const post = await photo();
    assert.equal((await moderation.removePostPermanently(post.id, admin.id, '  ')).ok, false);
    assert.equal((await stateOf(post.id)).removed, false);
  });

  it('takes it off FayTarra, deletes its files, keeps the record, and tells the author', async () => {
    const post = await photo('remove me');
    const someone = await reporter();
    await report(someone.id, post.id);
    const url = post.media[0].url;
    assert.deepEqual(await moderation.removePostPermanently(post.id, admin.id, 'Hate speech'), { ok: true });

    const row = await store.get('posts', post.id);
    assert.equal(row?.removed, true);
    assert.equal(row?.removed_reason, 'Hate speech');
    assert.equal(row?.caption, 'remove me', 'the record keeps what it said');
    assert.equal(onDisk(url), false, 'its file is deleted');
    const [reportRow] = await store.query('reports', { where: { target_id: post.id } });
    assert.equal(reportRow.status, 'resolved');
    const [logged] = await events(post.id, 'admin_removed_permanently');
    assert.equal(logged.actor_id, admin.id);
    assert.match(logged.detail, /Hate speech/);
    assert.deepEqual(await publiclyVisible(post.id, 'remove me'), { feed: false, profile: false, search: false, discover: false });
    const told = await store.query('notifications', { where: { user_id: author.id, post_id: post.id } });
    assert.ok(told.some((note) => /removed/i.test(note.body)));
  });

  it('keeps a file something else still uses', async () => {
    const url = file();
    await store.update('users', author.id, { avatar_url: url });
    const post = await photo('my avatar too', url);
    await moderation.removePostPermanently(post.id, admin.id, 'Spam');
    assert.equal(onDisk(url), true);
    await store.update('users', author.id, { avatar_url: null });
  });

  it('cannot then be restored, or deleted by its author', async () => {
    const post = await photo();
    await moderation.removePostPermanently(post.id, admin.id, 'Spam');
    assert.equal((await moderation.approvePost(post.id, admin.id)).ok, false);
    assert.deepEqual(await posts.deletePost(post.id, author.id), { ok: false, reason: 'moderated' });
  });
});

describe('the author while it is under review', () => {
  it('cannot delete it until the review is decided', async () => {
    const post = await photo();
    await reportedBy(post.id, THRESHOLD);
    assert.deepEqual(await posts.deletePost(post.id, author.id), { ok: false, reason: 'under_review' });
    assert.ok(await store.get('posts', post.id));
    await moderation.approvePost(post.id, admin.id);
    assert.equal((await posts.deletePost(post.id, author.id)).ok, true);
  });
});

describe('accounts', () => {
  it('no number of reports suspends or bans anybody', async () => {
    const post = await photo();
    const crowd = await Promise.all(Array.from({ length: 20 }, () => reporter()));
    for (const someone of crowd) await report(someone.id, post.id);
    await moderation.submitReport({ reporterId: crowd[0].id, targetType: 'user', targetId: author.id, reason: 'Spam' });
    assert.equal((await store.get('users', author.id))?.status, 'active');
  });

  it('a warning is a notification and a line in the log; nothing else changes', async () => {
    const target = await reporter('warned');
    assert.deepEqual(await moderation.warnUser(target.id, admin.id, 'Please keep it civil.'), { ok: true });
    const [note] = await store.query('notifications', { where: { user_id: target.id } });
    assert.match(note.body, /keep it civil/);
    assert.equal((await store.get('users', target.id))?.status, 'active');
    const [logged] = await store.query('moderation_events', { where: { target_id: target.id, action: 'admin_warned' } });
    assert.equal(logged.actor_id, admin.id);
  });

  it('a suspension needs a reason and one of the offered lengths', async () => {
    const target = await reporter('lengths');
    assert.equal((await moderation.setUserStatus(target.id, 'suspended', '', admin.id, { days: 7 })).ok, false);
    assert.equal((await moderation.setUserStatus(target.id, 'suspended', 'spam', admin.id, { days: 2 })).ok, false);
    assert.equal((await store.get('users', target.id))?.status, 'active');
  });

  it('a temporary suspension hides their posts, then ends on its own', async () => {
    const target = await reporter('temporary');
    const post = await posts.createPost({ authorId: target.id, caption: 'mine', category: 'Life', tags: [], media: [] });
    assert.deepEqual(await moderation.setUserStatus(target.id, 'suspended', 'Spamming', admin.id, { days: 1 }), { ok: true });
    const row = await store.get('users', target.id);
    assert.equal(row?.status, 'suspended');
    assert.ok(row?.suspended_until && new Date(row.suspended_until).getTime() > Date.now());
    assert.equal((await posts.visiblePosts(viewer.id)).some((p) => p.id === post.id), false);

    // The day passes.
    await store.update('users', target.id, { suspended_until: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await posts.visiblePosts(viewer.id)).some((p) => p.id === post.id), true, 'visible as soon as it ends');
    const lifted = await moderation.liftExpiredSuspension((await store.get('users', target.id))!);
    assert.equal(lifted.status, 'active');
    assert.equal((await store.get('users', target.id))?.status, 'active');
    const log = await store.query('moderation_events', { where: { target_id: target.id } });
    assert.ok(log.some((event) => event.action === 'suspension_expired'));
  });

  it('until reinstated means no end date; reversing it is logged', async () => {
    const target = await reporter('indefinite');
    await moderation.setUserStatus(target.id, 'suspended', 'Repeated harassment', admin.id, { days: null });
    assert.equal((await store.get('users', target.id))?.suspended_until ?? null, null);
    await moderation.setUserStatus(target.id, 'active', 'Appeal accepted', admin.id);
    assert.equal((await store.get('users', target.id))?.status, 'active');
    const log = await store.query('moderation_events', { where: { target_id: target.id } });
    assert.deepEqual(log.map((event) => event.action).sort(), ['admin_reinstated', 'admin_suspended']);
  });

  it('a ban is permanent until reversed, and needs a reason', async () => {
    const target = await reporter('banned');
    assert.equal((await moderation.setUserStatus(target.id, 'banned', '', admin.id)).ok, false);
    assert.deepEqual(await moderation.setUserStatus(target.id, 'banned', 'Threats', admin.id), { ok: true });
    assert.equal((await store.get('users', target.id))?.status, 'banned');
    assert.equal((await store.get('users', target.id))?.suspended_until ?? null, null);
  });

  it('flagging an account for abuse is logged, and its reports then hide nothing', async () => {
    const suspect = await reporter('suspect');
    assert.deepEqual(await moderation.setAbuseFlag(suspect.id, admin.id, true), { ok: true });
    assert.equal((await store.get('users', suspect.id))?.trusted, false);
    const post = await photo();
    assert.deepEqual(await report(suspect.id, post.id), { ok: true, hidden: false });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    const [flaggedEvent] = await store.query('moderation_events', { where: { target_id: suspect.id, action: 'admin_flagged' } });
    assert.equal(flaggedEvent.actor_id, admin.id);
    assert.deepEqual(await moderation.setAbuseFlag(suspect.id, admin.id, false), { ok: true });
    assert.equal((await store.get('users', suspect.id))?.trusted, true);
    assert.equal((await moderation.setAbuseFlag(otherAdmin.id, admin.id, true)).ok, false);
    assert.equal((await moderation.setAbuseFlag(admin.id, admin.id, true)).ok, false);
  });

  it('nobody can suspend or ban themselves, or another administrator', async () => {
    assert.equal((await moderation.setUserStatus(admin.id, 'banned', 'oops', admin.id)).ok, false);
    assert.equal((await moderation.setUserStatus(otherAdmin.id, 'suspended', 'takeover', admin.id, { days: 7 })).ok, false);
    assert.equal((await moderation.setUserStatus(otherAdmin.id, 'banned', 'takeover', admin.id)).ok, false);
    assert.equal((await store.get('users', otherAdmin.id))?.status, 'active');
  });
});

describe('what moderators read', () => {
  it('the queue: the post, its author, every report with who and how their reports went', async () => {
    const post = await photo('queue me');
    const loud = await reporter('loud');
    // An earlier report of theirs that a moderator dismissed.
    const earlier = await photo();
    await report(loud.id, earlier.id);
    const [old] = await store.query('reports', { where: { target_id: earlier.id } });
    await moderation.dismissReport(old.id, admin.id);

    await report(loud.id, post.id, 'Nudity', 'not for kids');
    await report(benched.id, post.id, 'Spam');
    await reportedBy(post.id, THRESHOLD - 1);
    const queue = await moderation.moderationQueue();
    const item = queue.hidden.find((entry) => entry.post.id === post.id);
    assert.ok(item, 'in the hidden queue');
    assert.equal(item.state, 'report_hold');
    assert.equal(item.post.kind, 'photo');
    assert.equal(item.author.username, author.username);
    assert.equal(item.openReports, THRESHOLD + 1);
    assert.equal(item.validReports, THRESHOLD);
    const theirs = item.reports.find((entry) => entry.reporter?.id === loud.id)!;
    assert.equal(theirs.reason, 'Nudity');
    assert.equal(theirs.details, 'not for kids');
    assert.equal(theirs.status, 'open');
    assert.equal(theirs.holding, true);
    assert.equal(theirs.reporter?.filed, 2);
    assert.equal(theirs.reporter?.dismissed, 1);
    const suspended = item.reports.find((entry) => entry.reporter?.id === benched.id)!;
    assert.equal(suspended.holding, false, 'shown, but not counted');
    assert.equal(suspended.reporter?.canHide, false);
    assert.ok(item.history.some((event) => event.action === 'auto_review_started'));
  });

  it('a visible post with reports that could not hide it is listed separately', async () => {
    const post = await photo();
    await report(flagged.id, post.id);
    const queue = await moderation.moderationQueue();
    assert.ok(queue.reported.some((entry) => entry.post.id === post.id && entry.state === 'visible'));
    assert.ok(!queue.hidden.some((entry) => entry.post.id === post.id));
  });

  it('the audit log names the admin, the action, the target, when, and why', async () => {
    const post = await photo('logged post');
    await report((await reporter()).id, post.id);
    await moderation.keepUnderReview(post.id, admin.id, 'needs a second look');
    const log = await moderation.moderationLog({ username: author.username });
    const held = log.find((entry) => entry.action === 'admin_held' && entry.targetId === post.id);
    assert.ok(held);
    assert.equal(held.actor, admin.username);
    assert.match(held.target, /logged post/);
    assert.match(held.detail, /second look/);
    assert.ok(held.createdAt);
  });
});
