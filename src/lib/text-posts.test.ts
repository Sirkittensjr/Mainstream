import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TEXT_LIMITS,
  drawnAs,
  normaliseTextPost,
  previewOf,
  textKindOf,
} from './text-posts';

describe('which kind a text post is', () => {
  it('takes the three it knows', () => {
    for (const kind of ['short', 'long', 'big']) assert.equal(textKindOf(kind), kind);
  });

  it('and nothing else, however it is spelled', () => {
    for (const bad of ['SHORT', 'huge', '', null, undefined, 7, {}]) {
      assert.equal(textKindOf(bad), null, String(bad));
    }
  });
});

describe('drawing a post that already existed', () => {
  /** The whole backwards-compatibility promise, in one test. */
  it('a text post from before kinds existed is drawn as a short one', () => {
    assert.equal(drawnAs({ caption: 'hello from 2024', media: [] }), 'short');
    assert.equal(drawnAs({ caption: 'hello', text_kind: null, media: [] }), 'short');
  });

  it('a post that says which kind it is, is drawn as that', () => {
    assert.equal(drawnAs({ caption: 'LET US GO', text_kind: 'big', media: [] }), 'big');
    assert.equal(drawnAs({ caption: 'the story', text_kind: 'long', media: [] }), 'long');
  });

  it('a post with media is not a text post, whatever it claims', () => {
    assert.equal(drawnAs({ caption: 'look', text_kind: 'big', media: [{}] }), null);
  });

  it('and neither is one with nothing written on it', () => {
    assert.equal(drawnAs({ caption: '   ', media: [] }), null);
  });

  it('survives a kind the database has never heard of', () => {
    assert.equal(drawnAs({ caption: 'hi', text_kind: 'enormous', media: [] }), 'short');
  });
});

describe('what gets stored', () => {
  it('keeps a short message as written', () => {
    const made = normaliseTextPost('short', null, '  Hey! What is up?  ');
    assert.deepEqual(made, { ok: true, kind: 'short', title: null, body: 'Hey! What is up?' });
  });

  it('cuts a short message at 200 characters', () => {
    const made = normaliseTextPost('short', null, 'a'.repeat(500));
    assert.ok(made.ok && made.body.length === TEXT_LIMITS.short.body);
  });

  it('cuts a big message at 30', () => {
    const made = normaliseTextPost('big', null, 'a'.repeat(90));
    assert.ok(made.ok && made.body.length === TEXT_LIMITS.big.body);
  });

  it('cuts a long message at 1,000, and its title at 30', () => {
    const made = normaliseTextPost('long', 't'.repeat(90), 'b'.repeat(4000));
    assert.ok(made.ok);
    assert.equal(made.title!.length, TEXT_LIMITS.long.title);
    assert.equal(made.body.length, TEXT_LIMITS.long.body);
  });

  it('drops a title from the kinds that do not have one', () => {
    for (const kind of ['short', 'big'] as const) {
      const made = normaliseTextPost(kind, 'a title', 'words');
      assert.ok(made.ok && made.title === null, kind);
    }
  });

  it('refuses a message with nothing in it', () => {
    const made = normaliseTextPost('short', null, '   \n  ');
    assert.ok(!made.ok && made.error.length > 0);
  });

  it('refuses a long message with no title, because the feed shows one', () => {
    const made = normaliseTextPost('long', '  ', 'a real body');
    assert.ok(!made.ok);
  });

  it('treats an unknown kind as short rather than storing it', () => {
    const made = normaliseTextPost('gigantic', null, 'hello');
    assert.ok(made.ok && made.kind === 'short');
  });
});

describe('the preview a long message shows in the feed', () => {
  it('shows the whole thing when it is already short', () => {
    assert.deepEqual(previewOf('All of it.'), { text: 'All of it.', clipped: false });
  });

  it('clips a long body and says it did', () => {
    const preview = previewOf('a'.repeat(300));
    assert.equal(preview.clipped, true);
    assert.ok(preview.text.length <= 50, `${preview.text.length}`);
  });

  it('cuts at a word rather than through one', () => {
    const body = 'The quick brown fox jumps over the lazy dog and keeps on running for miles';
    const preview = previewOf(body);
    assert.equal(preview.clipped, true);
    assert.ok(!preview.text.endsWith(' '));
    // What it kept is whole words from the start of the body.
    assert.ok(body.startsWith(preview.text), preview.text);
    assert.ok(preview.text.split(' ').every((word) => body.includes(word)));
  });

  it('does not lose most of the preview to one very long word', () => {
    const preview = previewOf(`${'x'.repeat(80)} tail`);
    assert.ok(preview.text.length > 40, `${preview.text.length}`);
  });

  it('is never longer than the limit it was given', () => {
    for (const limit of [10, 25, 50, 120]) {
      assert.ok(previewOf('word '.repeat(200), limit).text.length <= limit);
    }
  });
});
