import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BIG_STYLES,
  TEXT_KIND_COPY,
  TEXT_LIMITS,
  bigStyleOf,
  drawnAs,
  normaliseTextPost,
  previewOf,
  textKindOf,
} from './text-posts';

describe('which kind a text post is', () => {
  it('takes the three it knows', () => {
    for (const kind of ['short', 'story', 'big']) assert.equal(textKindOf(kind), kind);
  });

  it('and nothing else, however it is spelled', () => {
    for (const bad of ['SHORT', 'huge', '', null, undefined, 7, {}]) {
      assert.equal(textKindOf(bad), null, String(bad));
    }
  });

  /** The kind was called `long` for as long as it took to name it properly. */
  it('reads the old name for a story as a story', () => {
    assert.equal(textKindOf('long'), 'story');
  });

  it('and a row stored under the old name is drawn as one', () => {
    assert.equal(drawnAs({ caption: 'a tale', text_kind: 'long', media: [] }), 'story');
  });

  it('but a story is never written back under the old name', () => {
    const made = normaliseTextPost('long', 'A title', 'a body');
    assert.ok(made.ok && made.kind === 'story');
  });
});

describe('what the chooser says about each kind', () => {
  it('names all three and says what they are for', () => {
    assert.equal(TEXT_KIND_COPY.short.hint, 'Share a quick thought.');
    assert.equal(TEXT_KIND_COPY.story.hint, 'Tell the full story.');
    assert.equal(TEXT_KIND_COPY.big.hint, 'Make a statement.');
  });

  it('and spells out the limits it will hold them to', () => {
    assert.deepEqual(TEXT_KIND_COPY.short.limits, ['Max 200 characters']);
    assert.equal(TEXT_KIND_COPY.story.limits.length, 2);
    assert.ok(TEXT_KIND_COPY.story.limits[0].includes('30'));
    assert.ok(TEXT_KIND_COPY.story.limits[1].includes('1,000'));
    assert.deepEqual(TEXT_KIND_COPY.big.limits, ['Max 30 characters']);
  });

  /** The copy is what the composer clamps to; a drift between them is a lie. */
  it('and the numbers it quotes are the numbers it enforces', () => {
    assert.ok(TEXT_KIND_COPY.short.limits[0].includes(String(TEXT_LIMITS.short.body)));
    assert.ok(TEXT_KIND_COPY.big.limits[0].includes(String(TEXT_LIMITS.big.body)));
    assert.ok(TEXT_KIND_COPY.story.limits[0].includes(String(TEXT_LIMITS.story.title)));
  });
});

describe('how a big message is coloured', () => {
  it('offers four, not a colour picker', () => {
    assert.equal(BIG_STYLES.length, 4);
  });

  it('takes any of them', () => {
    for (const style of BIG_STYLES) assert.equal(bigStyleOf(style), style);
  });

  it('and falls back to the quietest for anything else', () => {
    for (const bad of ['rainbow', '#ff0000', '', null, undefined, 3, {}]) {
      assert.equal(bigStyleOf(bad), 'glow', String(bad));
    }
  });

  /** A big message written before the colours existed has no style at all. */
  it('so a big message with no colour stored still has one to draw', () => {
    assert.equal(bigStyleOf(null), 'glow');
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
    assert.equal(drawnAs({ caption: 'the story', text_kind: 'story', media: [] }), 'story');
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

  it('cuts a story at 1,000, and its title at 30', () => {
    const made = normaliseTextPost('story', 't'.repeat(90), 'b'.repeat(4000));
    assert.ok(made.ok);
    assert.equal(made.title!.length, TEXT_LIMITS.story.title);
    assert.equal(made.body.length, TEXT_LIMITS.story.body);
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

  it('refuses a story with no title, because the feed shows one', () => {
    const made = normaliseTextPost('story', '  ', 'a real body');
    assert.ok(!made.ok);
  });

  it('treats an unknown kind as short rather than storing it', () => {
    const made = normaliseTextPost('gigantic', null, 'hello');
    assert.ok(made.ok && made.kind === 'short');
  });
});

describe('the preview a story shows in the feed', () => {
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
