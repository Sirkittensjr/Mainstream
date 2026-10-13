/**
 * The signed "already verified" header: only the middleware can make one that
 * getViewer accepts. Everything here that is not a fresh signature from the
 * server's own key must come back null — which sends getViewer to Supabase,
 * the way it always worked.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readVerifiedUser, signVerifiedUser } from './verified-user';

const USER = '6675bde6-6944-4f67-bea5-8175ebe58545';
const OTHER = 'dc259573-4acd-4725-ba55-976735470172';
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests';
});
afterEach(() => {
  if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
});

describe('the middleware vouching for a user', () => {
  it('is accepted, for the user it names', async () => {
    const header = await signVerifiedUser(USER, NOW);
    assert.ok(header);
    assert.equal(await readVerifiedUser(header, NOW + 5_000), USER);
  });

  it('cannot be moved to somebody else', async () => {
    const header = (await signVerifiedUser(USER, NOW))!;
    const [, expiry, signature] = header.split('.');
    assert.equal(await readVerifiedUser(`${OTHER}.${expiry}.${signature}`, NOW), null);
  });

  it('cannot be made to last longer', async () => {
    const header = (await signVerifiedUser(USER, NOW))!;
    const [id, expiry, signature] = header.split('.');
    assert.equal(await readVerifiedUser(`${id}.${Number(expiry) + 1}.${signature}`, NOW), null);
  });

  it('runs out', async () => {
    const header = (await signVerifiedUser(USER, NOW))!;
    assert.equal(await readVerifiedUser(header, NOW + 61_000), null);
  });

  it('is refused when signed with any other key', async () => {
    const header = (await signVerifiedUser(USER, NOW))!;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a different deployment';
    assert.equal(await readVerifiedUser(header, NOW), null);
  });

  it('is never accepted, or made, without a key', async () => {
    const header = (await signVerifiedUser(USER, NOW))!;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(await readVerifiedUser(header, NOW), null);
    assert.equal(await signVerifiedUser(USER, NOW), null);
  });
});

describe('what a browser could send instead', () => {
  it('gets nowhere', async () => {
    const forged = [
      USER,
      `${USER}.${NOW + 30_000}`,
      `${USER}.${NOW + 30_000}.`,
      `${USER}.${NOW + 30_000}.c2lnbmF0dXJl`,
      `${USER}.${NOW + 30_000}.not base64!`,
      `${USER}.soon.c2lnbmF0dXJl`,
      `not-a-user-id.${NOW + 30_000}.c2lnbmF0dXJl`,
      '',
      null,
      undefined,
    ];
    for (const value of forged) {
      assert.equal(await readVerifiedUser(value, NOW), null, String(value));
    }
  });

  it('cannot even get a signature over something that is not a user id', async () => {
    assert.equal(await signVerifiedUser('admin', NOW), null);
  });
});
