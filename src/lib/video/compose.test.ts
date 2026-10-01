import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captionTitle, postCaption } from './compose';
import { normaliseTags } from './hashtags';

describe('the final post screen', () => {
  it('posts the title as the caption when that is all there is', () => {
    assert.equal(postCaption('First skate line'), 'First skate line');
    assert.equal(captionTitle(postCaption('First skate line')), 'First skate line');
  });

  it('keeps the title as the first line, with the description under it', () => {
    const caption = postCaption('First skate line', 'Filmed at the bowl on Sunday.');
    assert.equal(caption, 'First skate line\n\nFilmed at the bowl on Sunday.');
    assert.equal(captionTitle(caption), 'First skate line');
  });

  it('posts a description on its own, for somebody who left the title empty', () => {
    assert.equal(postCaption('   ', 'Just this.'), 'Just this.');
  });

  it('is empty when nothing was written, rather than blank lines', () => {
    assert.equal(postCaption('', ''), '');
    assert.equal(postCaption('   ', '   '), '');
  });

  it('keeps hashtags out of the caption and in the tags', () => {
    // The whole point of the structured field: what the author typed as tags
    // is stored as tags, and the caption is what they wrote.
    const caption = postCaption('First skate line', 'Filmed at the bowl.');
    assert.equal(caption.includes('#'), false);
    assert.deepEqual(normaliseTags(['#skate', 'bowl']), ['skate', 'bowl']);
  });
});

describe('the tags a post is stored with', () => {
  it('takes the list the posting screen sends', () => {
    assert.deepEqual(normaliseTags(['skate', 'bowl']), ['skate', 'bowl']);
  });

  it('still splits a string from an older client', () => {
    assert.deepEqual(normaliseTags('firstvideo, studio'), ['firstvideo', 'studio']);
    assert.deepEqual(normaliseTags('#one #two'), ['one', 'two']);
  });

  it('is empty for nothing at all', () => {
    assert.deepEqual(normaliseTags(''), []);
    assert.deepEqual(normaliseTags(undefined), []);
    assert.deepEqual(normaliseTags(null), []);
  });

  it('refuses more than the post keeps, and never the same tag twice', () => {
    assert.deepEqual(normaliseTags(['a', 'A', 'a']), ['a']);
    assert.equal(normaliseTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 8);
  });
});
