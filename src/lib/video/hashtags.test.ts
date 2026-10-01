import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_TAGS, MAX_TAG_LENGTH, addTag, cleanTag } from './hashtags';

describe('hashtags on the posting screen', () => {
  it('stores a tag as a tag, without the hash', () => {
    assert.equal(cleanTag('#firstvideo'), 'firstvideo');
    assert.equal(cleanTag('  studio '), 'studio');
    assert.equal(cleanTag('###skate'), 'skate');
  });

  it('keeps letters, numbers and underscores in any script', () => {
    assert.equal(cleanTag('drum_and_bass2'), 'drum_and_bass2');
    assert.equal(cleanTag('#café'), 'café');
    assert.equal(cleanTag('#音楽'), '音楽');
  });

  it('is not a tag at all when there is nothing left of it', () => {
    assert.equal(cleanTag('#'), null);
    assert.equal(cleanTag('   '), null);
    assert.equal(cleanTag('!!!'), null);
  });

  it('cuts a tag nobody could have meant to be that long', () => {
    assert.equal(cleanTag('a'.repeat(80))?.length, MAX_TAG_LENGTH);
  });

  it('adds tags in the order they were typed', () => {
    assert.deepEqual(addTag(addTag([], '#one'), 'two'), ['one', 'two']);
  });

  it('does not add the same tag twice, whatever its case', () => {
    assert.deepEqual(addTag(['Skate'], '#skate'), ['Skate']);
    assert.deepEqual(addTag(['skate'], 'skate'), ['skate']);
  });

  it('stops at the limit the post will actually keep', () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `tag${i}`);
    assert.deepEqual(addTag(full, 'onemore'), full);
  });

  it('ignores something that is not a tag', () => {
    assert.deepEqual(addTag(['one'], '   '), ['one']);
    assert.deepEqual(addTag(['one'], '#'), ['one']);
  });
});
