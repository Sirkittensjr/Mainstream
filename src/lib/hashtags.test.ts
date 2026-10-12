import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captionHashtags, postHashtags, postHasTag, tagHref, tagKey } from './hashtags';

describe('one hashtag, whatever its case', () => {
  it('#Gaming, #gaming, GAMING and " #gaming " share one key', () => {
    for (const spelling of ['#Gaming', 'gaming', 'GAMING', ' #gaming ', '##Gaming']) {
      assert.equal(tagKey(spelling), 'gaming', spelling);
    }
  });

  it('keeps letters in any script, numbers and underscores', () => {
    assert.equal(tagKey('#Café_2024'), 'café_2024');
    assert.equal(tagKey('#ÉTÉ'), 'été');
    assert.equal(tagKey('#東京'), '東京');
  });

  it('nothing but punctuation is not a hashtag', () => {
    assert.equal(tagKey('#'), null);
    assert.equal(tagKey('!!!'), null);
    assert.equal(tagKey(''), null);
  });

  it('links to one page per hashtag, safely encoded', () => {
    assert.equal(tagHref('gaming'), '/tag/gaming');
    assert.equal(tagHref('東京'), `/tag/${encodeURIComponent('東京')}`);
  });
});

describe('hashtags written into a caption', () => {
  it('finds them at the start, mid-sentence and after punctuation', () => {
    assert.deepEqual(captionHashtags('#first then #Second, and (#third).'), ['first', 'Second', 'third']);
    assert.deepEqual(captionHashtags('line one\n#onanewline'), ['onanewline']);
  });

  it('a number is not a hashtag, but a word with numbers in it is', () => {
    assert.deepEqual(captionHashtags('open mic #31. be honest about #3'), []);
    assert.deepEqual(captionHashtags('day #100daysofcode'), ['100daysofcode']);
  });

  it('a # inside a word, a link or an entity is not one', () => {
    assert.deepEqual(captionHashtags('email me at a#b or see example.com/page#top'), []);
    assert.deepEqual(captionHashtags('C# and ##double'), []);
    assert.deepEqual(captionHashtags('&#847;'), []);
  });

  it('none in an empty caption', () => {
    assert.deepEqual(captionHashtags(''), []);
    assert.deepEqual(captionHashtags(null), []);
  });
});

describe('every hashtag a post carries', () => {
  it('its tags first, exactly as stored, then its caption’s', () => {
    const tags = postHashtags({ tags: ['Gaming', 'clips'], caption: 'one shot #NoCuts' });
    assert.deepEqual(
      tags.map((tag) => [tag.label, tag.key, tag.fromCaption]),
      [
        ['Gaming', 'gaming', false],
        ['clips', 'clips', false],
        ['NoCuts', 'nocuts', true],
      ],
    );
  });

  it('one entry per hashtag, whatever the case — the first spelling wins', () => {
    const tags = postHashtags({ tags: ['Gaming', 'gaming'], caption: '#GAMING #clips #Clips' });
    assert.deepEqual(tags.map((tag) => tag.label), ['Gaming', 'clips']);
  });

  it('a stored tag that cannot be linked is still shown, unlinked', () => {
    const tags = postHashtags({ tags: ['!!!'] });
    assert.deepEqual(tags, [{ label: '!!!', key: null, fromCaption: false }]);
  });

  it('a post from before tags existed, with no tags at all, is fine', () => {
    assert.deepEqual(postHashtags({ caption: 'no tags here' }), []);
    assert.deepEqual(postHashtags({ tags: null, caption: null }), []);
  });

  it('matches by key, so case never matters', () => {
    const post = { tags: ['Gaming'], caption: 'and #Retro too' };
    assert.equal(postHasTag(post, 'gaming'), true);
    assert.equal(postHasTag(post, 'retro'), true);
    assert.equal(postHasTag(post, 'game'), false);
  });
});
