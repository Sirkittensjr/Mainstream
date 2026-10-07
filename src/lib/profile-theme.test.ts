import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PROFILE_COLORS,
  PROFILE_DEFAULT,
  PROFILE_GRADIENTS,
  isProfileBackgroundKey,
  isProfileColorKey,
  profileBackground,
  profileSkin,
} from './profile-theme';
import { mediaKindForUrl, sanitiseAvatarUrl } from './media';

describe('profile backgrounds', () => {
  it('accepts every colour and every gradient as a background', () => {
    for (const entry of [...PROFILE_COLORS, ...PROFILE_GRADIENTS]) {
      assert.equal(isProfileBackgroundKey(entry.key), true, entry.key);
    }
    assert.equal(isProfileBackgroundKey(PROFILE_DEFAULT), true);
  });

  it('keeps boxes to solid colours — a gradient is not a box', () => {
    for (const gradient of PROFILE_GRADIENTS) {
      assert.equal(isProfileColorKey(gradient.key), false, gradient.key);
    }
  });

  it('refuses anything that is not a key, so nothing reaches a stylesheet', () => {
    for (const junk of ['', 'url(https://evil.example/x.png)', 'linear-gradient(red, blue)', null, 42]) {
      assert.equal(isProfileBackgroundKey(junk), false, String(junk));
    }
    assert.equal(profileBackground('not-a-colour'), null);
  });

  it('existing colour keys still resolve exactly as before', () => {
    for (const colour of PROFILE_COLORS) {
      assert.deepEqual(profileBackground(colour.key), colour);
    }
  });

  it('a gradient carries a solid stand-in for anything that needs one colour', () => {
    for (const gradient of PROFILE_GRADIENTS) {
      assert.match(gradient.hex, /^#[0-9A-F]{6}$/i);
      assert.match(gradient.gradient ?? '', /^linear-gradient\(/);
    }
  });
});

describe('profileSkin', () => {
  it('is null for a profile with nothing chosen — it looks as it always has', () => {
    assert.equal(profileSkin(null, null), null);
  });

  it('paints a gradient background through its own variable', () => {
    const skin = profileSkin('fay-aurora', null);
    assert.ok(skin);
    assert.equal(skin.style['--profile-bg-image'], PROFILE_GRADIENTS.find((g) => g.key === 'fay-aurora')?.gradient);
    assert.equal(skin.style['--profile-bg'], '#2E1A6A');
  });

  it('a solid colour has no gradient', () => {
    assert.equal(profileSkin('purple', null)?.style['--profile-bg-image'], 'none');
  });

  it('a photo alone still skins the page, with light text on it', () => {
    const skin = profileSkin(null, null, { photo: true });
    assert.ok(skin);
    assert.equal(skin.style['--profile-page-ink'], '#FFFFFF');
  });

  it('a photo over a bright colour keeps the page text light — it sits under a dark scrim', () => {
    assert.equal(profileSkin('yellow-bright', null)?.style['--profile-page-ink'], '#0A0A12');
    assert.equal(
      profileSkin('yellow-bright', null, { photo: true })?.style['--profile-page-ink'],
      '#FFFFFF',
    );
  });

  it('the boxes keep their own ink whatever the background', () => {
    assert.equal(profileSkin('fay-glow', 'yellow-bright', { photo: true })?.style['--profile-ink'], '#0A0A12');
  });
});

describe('a background photo address', () => {
  it('must be an image FayTarra stored itself', () => {
    const own = '/api/media/42fda568-743a-4b1c-9781-86f06bad4beb.jpg';
    assert.equal(sanitiseAvatarUrl(own), own);
    assert.equal(mediaKindForUrl(own), 'image');
    assert.equal(sanitiseAvatarUrl('https://evil.example/cover.jpg'), null);
    assert.equal(sanitiseAvatarUrl('/api/media/../secrets.jpg'), null);
  });

  it('a video is not a background', () => {
    assert.equal(mediaKindForUrl('/api/media/clip.mp4'), 'video');
  });
});
