import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentTypeFor } from './upload-client';

const file = (name: string, type: string) => ({ name, type }) as File;

describe('deciding what to call a file before sending it', () => {
  it('takes the browser at its word when the word is one we know', () => {
    assert.equal(contentTypeFor(file('a.mp4', 'video/mp4')), 'video/mp4');
    assert.equal(contentTypeFor(file('a.png', 'image/png')), 'image/png');
  });

  it('falls back to the extension when the type is missing or generic', () => {
    // A .mov dragged out of some apps arrives with no type at all.
    assert.equal(contentTypeFor(file('clip.mov', '')), 'video/quicktime');
    assert.equal(contentTypeFor(file('clip.MOV', 'application/octet-stream')), 'video/quicktime');
    assert.equal(contentTypeFor(file('holiday.MP4', '')), 'video/mp4');
    assert.equal(contentTypeFor(file('photo.JPG', '')), 'image/jpeg');
  });

  it('normalises the spellings that are not the standard one', () => {
    assert.equal(contentTypeFor(file('a.jpg', 'image/jpg')), 'image/jpeg');
    assert.equal(contentTypeFor(file('a.m4v', 'video/x-m4v')), 'video/mp4');
  });

  it('passes an unknown type through rather than inventing one', () => {
    // The server refuses it by name; guessing here would only hide why.
    assert.equal(contentTypeFor(file('a.exe', 'application/x-msdownload')), 'application/x-msdownload');
  });
});
