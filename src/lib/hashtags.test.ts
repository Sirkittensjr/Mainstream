import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_HASHTAGS_PER_POST,
  extractHashtags,
  extraTags,
  hasHashtag,
  hashtagHref,
  hashtagQuery,
  normaliseHashtag,
  postHashtags,
  splitHashtags,
} from './hashtags';

const tags = (list: { tag: string }[]) => list.map((hashtag) => hashtag.tag);

describe('one hashtag, however it is capitalised', () => {
  it('normalises #Gaming, #gaming and #GAMING to the same tag', () => {
    assert.equal(normaliseHashtag('#Gaming'), 'gaming');
    assert.equal(normaliseHashtag('#gaming'), 'gaming');
    assert.equal(normaliseHashtag('#GAMING'), 'gaming');
    assert.equal(normaliseHashtag('Gaming'), 'gaming');
  });

  it('gives every capitalisation the same page', () => {
    assert.equal(hashtagHref('Gaming'), '/tag/gaming');
    assert.equal(hashtagHref('#GAMING'), '/tag/gaming');
    assert.equal(hashtagHref('gaming'), '/tag/gaming');
  });

  it('handles letters beyond English', () => {
    assert.equal(normaliseHashtag('#Café'), 'café');
    assert.equal(normaliseHashtag('#ÜBER'), 'über');
    assert.equal(hashtagHref('Café'), `/tag/${encodeURIComponent('café')}`);
    // The same word typed as one character or as a letter plus an accent.
    assert.equal(normaliseHashtag('#Café'), normaliseHashtag('#Café'));
  });

  it('refuses things that are not hashtags', () => {
    for (const raw of ['', '#', '##', '#31', '1', 'two words', '#tag!', 'x'.repeat(51), null, undefined]) {
      assert.equal(normaliseHashtag(raw as string), null, String(raw));
    }
  });
});

describe('finding hashtags in what was published', () => {
  it('finds every #word, in order, each once', () => {
    assert.deepEqual(extractHashtags('Clutched it #Gaming #fps and again #gaming'), [
      { tag: 'gaming', display: 'Gaming' },
      { tag: 'fps', display: 'fps' },
    ]);
  });

  it('stops a hashtag at punctuation', () => {
    assert.deepEqual(tags(extractHashtags('so good #Gaming! (#clips), #art.')), ['gaming', 'clips', 'art']);
  });

  it('ignores what only looks like one', () => {
    assert.deepEqual(extractHashtags('open mic #31 tonight'), [], 'a number');
    assert.deepEqual(extractHashtags('see example.com/page#section'), [], 'a link');
    assert.deepEqual(extractHashtags('I write C# all day'), [], 'the middle of a word');
    assert.deepEqual(extractHashtags('it&#39;s fine'), [], 'an HTML entity');
  });

  it('files photo, video and text posts the same way', () => {
    const photo = { caption: 'Golden hour #Photography', tags: [] };
    const video = { caption: 'one take', tags: ['Gaming', 'clips'] };
    const story = { caption: 'and then it rained #weather', text_title: 'A #Rainy day', tags: [] };
    assert.deepEqual(tags(postHashtags(photo)), ['photography']);
    assert.deepEqual(tags(postHashtags(video)), ['gaming', 'clips']);
    assert.deepEqual(tags(postHashtags(story)), ['rainy', 'weather']);
  });

  it('merges a tag and the same word in the caption into one', () => {
    const post = { caption: 'new setup #GAMING', tags: ['gaming', 'setup'] };
    assert.deepEqual(tags(postHashtags(post)), ['gaming', 'setup']);
    assert.ok(hasHashtag(post, 'gaming'));
    assert.ok(!hasHashtag(post, 'clips'));
  });

  it('has a ceiling on how many one post is filed under', () => {
    const caption = Array.from({ length: 50 }, (_, i) => `#tag${String.fromCharCode(97 + (i % 26))}${i}`).join(' ');
    assert.equal(postHashtags({ caption, tags: [] }).length, MAX_HASHTAGS_PER_POST);
  });

  it('shows the tags that are not already written in the words', () => {
    const post = { caption: 'new setup #Gaming', tags: ['gaming', 'Setup', '2024'] };
    assert.deepEqual(extraTags(post), [{ tag: 'setup', display: 'Setup' }]);
  });
});

describe('drawing text with hashtags in it', () => {
  it('cuts text into words and hashtag links, losing nothing', () => {
    const text = 'Clutch! #Gaming and #fps, ok';
    const parts = splitHashtags(text);
    assert.equal(parts.map((part) => part.text).join(''), text);
    assert.deepEqual(
      parts.filter((part) => part.hashtag).map((part) => [part.text, hashtagHref(part.hashtag!.tag)]),
      [
        ['#Gaming', '/tag/gaming'],
        ['#fps', '/tag/fps'],
      ],
    );
  });

  it('leaves text with no hashtags as it is', () => {
    assert.deepEqual(splitHashtags('nothing to see'), [{ text: 'nothing to see' }]);
  });
});

describe('searching for a hashtag', () => {
  it('reads Gaming and #Gaming as the same hashtag', () => {
    assert.equal(hashtagQuery('Gaming'), 'gaming');
    assert.equal(hashtagQuery('  #Gaming '), 'gaming');
  });

  it('does not read a phrase as a hashtag', () => {
    assert.equal(hashtagQuery('gaming clips'), null);
    assert.equal(hashtagQuery(''), null);
  });
});
