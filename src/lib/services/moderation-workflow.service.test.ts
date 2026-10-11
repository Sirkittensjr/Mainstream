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

describe('a report from an eligible account hides the post at once', () => {
  it('everywhere the public looks — and nothing is deleted', async () => {
    const post = await photo('sunset over the harbour');
    const before = await publiclyVisible(post.id, 'harbour');
    assert.deepEqual(before, { feed: true, profile: true, search: true, discover: true });

    const someone = await reporter();
    assert.deepEqual(await report(someone.id, post.id, 'Spam', 'looks like an ad'), { ok: true, hidden: true });

    assert.deepEqual(await publiclyVisible(post.id, 'harbour'), {
      feed: false,
      profile: false,
      search: false,
      discover: false,
    });
    const row = await store.get('posts', post.id);
    assert.equal(row?.review_state, 'temporary_review');
    assert.equal(row?.review_expires_at ?? null, null, 'no expiry: it waits for a moderator');
    assert.equal(row?.removed, false);
    assert.equal(onDisk(post.media[0].url), true, 'its file is kept');
  });

  it('its author and moderators still see it', async () => {
    const post = await photo();
    await report((await reporter()).id, post.id);
    assert.ok((await posts.postsByAuthor(author.id, author)).some((p) => p.id === post.id));
    assert.ok((await posts.postsByAuthor(author.id, admin)).some((p) => p.id === post.id));
  });

  it('the log says whose report hid it; the author is told, without being told who', async () => {
    const post = await photo();
    const someone = await reporter('named');
    await report(someone.id, post.id, 'Harassment');
    const [hide] = await events(post.id, 'report_hidden');
    assert.equal(hide.actor_id, someone.id);
    assert.match(hide.detail, /Harassment/);
    const told = (await store.query('notifications', { where: { user_id: author.id, post_id: post.id } }))[0];
    assert.ok(told, 'the author is notified');
    assert.ok(!told.body.includes(someone.username), 'and not told who reported it');
    assert.match(told.body, /review/i);
  });

  it('it survives a restart: the state is written to the store, not kept in memory', async () => {
    const post = await photo();
    await report((await reporter()).id, post.id);
    // What a fresh process would load: the file on disk.
    const { readFileSync } = await import('node:fs');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const saved = JSON.parse(readFileSync(path.join(dataDir, 'faytarra.json'), 'utf8'));
    const row = saved.posts.find((p: { id: string }) => p.id === post.id);
    assert.equal(row.review_state, 'temporary_review');
    assert.ok(saved.reports.some((r: { target_id: string }) => r.target_id === post.id));
  });
});

describe('who can hide a post by reporting it', () => {
  it('a suspended account: recorded, not hidden', async () => {
    const post = await photo();
    assert.deepEqual(await report(benched.id, post.id), { ok: true, hidden: false });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, 1);
  });

  it('an account flagged for abuse: recorded, not hidden', async () => {
    const post = await photo();
    assert.deepEqual(await report(flagged.id, post.id), { ok: true, hidden: false });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
  });

  it('a banned account: not even recorded', async () => {
    const post = await photo();
    assert.equal((await report(banned.id, post.id)).ok, false);
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, 0);
  });
});

describe('one account, one report — and duplicates change nothing', () => {
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
    assert.equal((await events(post.id, 'report_hidden')).length, 1, 'hidden once');
  });

  it('the same report sent five times at once is one report and one hide', async () => {
    const post = await photo();
    const someone = await reporter();
    const results = await Promise.all(Array.from({ length: 5 }, () => report(someone.id, post.id)));
    assert.ok(results.every((result) => result.ok));
    assert.equal(results.filter((result) => result.ok && result.hidden).length, 1);
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, 1);
    assert.equal((await events(post.id, 'report_hidden')).length, 1);
  });

  it('ten different accounts reporting at once hide it once, consistently', async () => {
    const post = await photo();
    const people = await Promise.all(Array.from({ length: 10 }, () => reporter()));
    const results = await Promise.all(people.map((someone) => report(someone.id, post.id)));
    assert.ok(results.every((result) => result.ok));
    assert.equal(results.filter((result) => result.ok && result.hidden).length, 1);
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, 10);
    assert.equal((await events(post.id, 'report_hidden')).length, 1);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'temporary_review' });
  });
});

describe('each reporter can have at most five posts hidden and waiting', () => {
  it('the sixth report is recorded but hides nothing', async () => {
    const someone = await reporter();
    const seven = await Promise.all(Array.from({ length: 7 }, () => photo()));
    const results = [];
    for (const post of seven) results.push(await report(someone.id, post.id));
    assert.deepEqual(
      results.map((result) => result.ok && result.hidden),
      [true, true, true, true, true, false, false],
    );
    assert.equal((await moderation.activeHoldsBy(someone.id)).length, 5);
    assert.equal((await events(seven[5].id, 'report_hold_limit')).length, 1);
    assert.equal((await store.query('reports', { where: { target_id: seven[6].id } })).length, 1);
  });

  it('sent all at once, still no more than five', async () => {
    const someone = await reporter();
    const eight = await Promise.all(Array.from({ length: 8 }, () => photo()));
    const results = await Promise.all(eight.map((post) => report(someone.id, post.id)));
    assert.equal(results.filter((result) => result.ok && result.hidden).length, 5);
    assert.equal((await moderation.activeHoldsBy(someone.id)).length, 5);
    const hidden = [];
    for (const post of eight) if ((await stateOf(post.id)).review) hidden.push(post.id);
    assert.equal(hidden.length, 5);
  });

  it('a decision frees a place', async () => {
    const someone = await reporter();
    const six = await Promise.all(Array.from({ length: 6 }, () => photo()));
    for (const post of six.slice(0, 5)) await report(someone.id, post.id);
    assert.deepEqual(await report(someone.id, six[5].id), { ok: true, hidden: false }, 'at the limit');
    await moderation.approvePost(six[0].id, admin.id, 'fine');
    const another = await photo();
    assert.deepEqual(await report(someone.id, another.id), { ok: true, hidden: true });
  });
});

describe('approve and restore', () => {
  it('brings it back with every like, comment and rating it had', async () => {
    const post = await photo('worth keeping');
    const fan = await reporter('fan');
    await posts.toggleLike(post.id, fan.id);
    await posts.addComment(post.id, fan.id, 'love this');
    const rated = await ratings.submitRating({ raterId: fan.id, targetType: 'post', targetId: post.id, score: 9, reactions: [] });
    assert.ok(rated.ok);

    await report((await reporter()).id, post.id);
    assert.deepEqual(await moderation.approvePost(post.id, admin.id, 'not spam'), { ok: true });

    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    assert.deepEqual(await publiclyVisible(post.id, 'worth keeping'), { feed: true, profile: true, search: true, discover: true });
    assert.equal((await store.query('likes', { where: { post_id: post.id } })).length, 1);
    assert.equal((await store.query('comments', { where: { post_id: post.id } })).length, 1);
    assert.equal((await store.query('ratings', { where: { target_id: post.id } })).length, 1);
  });

  it('resolves its reports, and the people who reported it cannot hide it again', async () => {
    const post = await photo();
    const first = await reporter('first');
    await report(first.id, post.id, 'Spam');
    await moderation.approvePost(post.id, admin.id);
    const [row] = await store.query('reports', { where: { target_id: post.id } });
    assert.equal(row.status, 'resolved');
    assert.ok(row.cleared_at);

    // Reported again by the same account: read by a person, hides nothing.
    assert.deepEqual(await report(first.id, post.id, 'Harassment'), { ok: true, hidden: false });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    const again = await store.get('reports', row.id);
    assert.equal(again?.status, 'open', 'back in front of a moderator');
    assert.ok(again?.cleared_at, 'but it cannot hide or hold the post');
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, 1, 'history kept, not duplicated');

    // Somebody new still can.
    assert.deepEqual(await report((await reporter('newcomer')).id, post.id), { ok: true, hidden: true });
  });
});

describe('keep under review', () => {
  it('holds it hidden; dismissing every report does not reveal it; approval does', async () => {
    const post = await photo();
    const someone = await reporter();
    await report(someone.id, post.id);
    assert.deepEqual(await moderation.keepUnderReview(post.id, admin.id, 'checking with the author'), { ok: true });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'admin_hold' });

    const [row] = await store.query('reports', { where: { target_id: post.id } });
    assert.deepEqual(await moderation.dismissReport(row.id, admin.id, 'unfounded'), { ok: true });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'admin_hold' }, 'still held');

    await moderation.approvePost(post.id, admin.id);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
  });

  it('can hide a post nobody eligible reported', async () => {
    const post = await photo();
    await report(flagged.id, post.id);
    assert.deepEqual(await moderation.keepUnderReview(post.id, admin.id), { ok: true });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'admin_hold' });
  });
});

describe('dismissing a report', () => {
  it('the only report keeping it hidden: dismissed, and the post is back', async () => {
    const post = await photo();
    await report((await reporter()).id, post.id);
    const [row] = await store.query('reports', { where: { target_id: post.id } });
    assert.deepEqual(await moderation.dismissReport(row.id, admin.id, 'not a rule break'), { ok: true });
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
    assert.equal((await events(post.id, 'review_lifted')).length, 1);
    assert.equal((await store.get('reports', row.id))?.status, 'dismissed');
  });

  it('with another valid report still open: still hidden until that one is dealt with too', async () => {
    const post = await photo();
    await report((await reporter()).id, post.id);
    await report((await reporter()).id, post.id);
    const [a, b] = await store.query('reports', { where: { target_id: post.id } });
    await moderation.dismissReport(a.id, admin.id);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: 'temporary_review' });
    await moderation.dismissReport(b.id, admin.id);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
  });

  it('a report from a suspended account does not keep it hidden on its own', async () => {
    const post = await photo();
    await report((await reporter()).id, post.id);
    await report(benched.id, post.id);
    const eligible = (await store.query('reports', { where: { target_id: post.id } })).find(
      (row) => row.reporter_id !== benched.id,
    )!;
    await moderation.dismissReport(eligible.id, admin.id);
    assert.deepEqual(await stateOf(post.id), { removed: false, review: null });
  });

  it('never restores a removed post', async () => {
    const post = await photo();
    await report((await reporter()).id, post.id);
    await report((await reporter()).id, post.id);
    const [a] = await store.query('reports', { where: { target_id: post.id } });
    await moderation.removePostPermanently(post.id, admin.id, 'Graphic violence');
    // Already resolved by the removal: dismissing it again is refused and changes nothing.
    assert.equal((await moderation.dismissReport(a.id, admin.id)).ok, false);
    assert.equal((await stateOf(post.id)).removed, true);
  });

  it('twice is refused the second time', async () => {
    const post = await photo();
    await report((await reporter()).id, post.id);
    const [row] = await store.query('reports', { where: { target_id: post.id } });
    const both = await Promise.all([moderation.dismissReport(row.id, admin.id), moderation.dismissReport(row.id, admin.id)]);
    assert.equal(both.filter((result) => result.ok).length, 1);
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
    await report((await reporter()).id, post.id);
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
    const queue = await moderation.moderationQueue();
    const item = queue.hidden.find((entry) => entry.post.id === post.id);
    assert.ok(item, 'in the hidden queue');
    assert.equal(item.state, 'report_hold');
    assert.equal(item.post.kind, 'photo');
    assert.equal(item.author.username, author.username);
    assert.equal(item.hiddenBy, loud.username);
    assert.equal(item.openReports, 2);
    assert.equal(item.uniqueReporters, 2);
    const theirs = item.reports.find((entry) => entry.reporter?.id === loud.id)!;
    assert.equal(theirs.reason, 'Nudity');
    assert.equal(theirs.details, 'not for kids');
    assert.equal(theirs.holding, true);
    assert.equal(theirs.reporter?.filed, 2);
    assert.equal(theirs.reporter?.dismissed, 1);
    assert.equal(theirs.reporter?.holding, 1);
    const suspended = item.reports.find((entry) => entry.reporter?.id === benched.id)!;
    assert.equal(suspended.holding, false);
    assert.equal(suspended.reporter?.canHide, false);
    assert.ok(item.history.some((event) => event.action === 'report_hidden' && event.actor === loud.username));
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
