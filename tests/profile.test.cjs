const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');

async function app(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(readFileSync(require.resolve('../migrations/0002_profiles.sql'), 'utf8'));
  sql.exec(readFileSync(require.resolve('../migrations/0004_account_links.sql'), 'utf8'));
  const env = {
    AUTH_COOKIE_SECRET: 'profile-tests-with-at-least-32-characters',
    RESEND_API_KEY: 'local-mail-provider',
    DVN_AUTH_DB: { prepare(query) {
      const statement = sql.prepare(query);
      return { bind: (...args) => ({
        first: async () => statement.get(...args) || null,
        run: async () => ({ meta: { changes: statement.run(...args).changes } }),
      }) };
    } },
  };
  const { seal } = await import('../functions/api/auth/_lib.js');
  const { onRequestGet } = await import('../functions/api/auth/session.js');
  const { onRequestPost } = await import('../functions/api/auth/profile.js');
  const site = 'https://dvnclothing.com';
  async function forIdentity(claims) {
    const token = await seal({ ...claims, exp: Math.floor(Date.now() / 1000) + 120 }, env.AUTH_COOKIE_SECRET);
    const headers = { Cookie: '__Host-dvn-session=' + token };
    return {
      session: async () => (await onRequestGet({ request: new Request(site + '/api/auth/session', { headers }), env })).json(),
      save: (changes, origin = site) => onRequestPost({
        request: new Request(site + '/api/auth/profile', {
          method: 'POST', body: JSON.stringify(changes),
          headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
        }), env,
      }),
    };
  }
  return { forIdentity, env };
}

const address = 'Caps@example.test';
const google = { sub: 'google-subject', name: 'Alex', email: address, picture: 'https://lh3.googleusercontent.com/a/photo' };
const email = { sub: 'email:' + address, name: address, email: address };
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqGkAAAAASUVORK5CYII=';

test('both providers persist isolated profile edits without Google credentials', async t => {
  const api = await app(t);
  const first = await api.forIdentity(google);
  const second = await api.forIdentity(email);
  const a = await first.session();
  const b = await second.session();
  assert.equal(b.configured, false);
  assert.equal(b.emailConfigured, true);
  assert.equal(b.profileConfigured, true);
  assert.equal(b.user.provider, 'email');
  assert.equal(a.user.picture, google.picture);
  assert.notEqual(a.user.id, b.user.id);
  assert.equal((await second.save({ name: 'My Name', avatar: image })).status, 200);
  assert.equal((await second.save({ name: 'Renamed' })).status, 200);
  const signedInAgain = await api.forIdentity(email);
  const updated = (await signedInAgain.session()).user;
  assert.equal(updated.id, b.user.id);
  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.picture, image);
  assert.equal((await first.session()).user.name, 'Alex');
  assert.equal((await first.save({ avatar: '' })).status, 200);
  assert.equal((await first.session()).user.picture, '');
});

test('profile rejects foreign origins, invalid avatars and untrusted identity data', async t => {
  const api = await app(t);
  const session = await api.forIdentity({ ...google, picture: 'https://lh3.googleusercontent.com.example.org/a' });
  assert.equal((await session.session()).user.picture, '');
  assert.equal((await session.save({ name: 'Name' }, 'https://other.example')).status, 403);
  for (const body of [{ id: 'another-id' }, { name: ' ' }, { avatar: 'https://example.org/pixel' }, { avatar: 'data:image/svg+xml;base64,PHN2Zy8+' }, { avatar: image.replace('png', 'jpeg') }]) {
    assert.equal((await session.save(body)).status, 400);
  }
  const pending = await api.forIdentity({ state: 'pending', nonce: 'pending' });
  assert.equal((await pending.session()).user, null);
  assert.equal((await pending.save({ name: 'Name' })).status, 401);
  assert.equal((await session.save({ avatar: 'a'.repeat(180001) })).status, 413);
});

test('explicit links keep a stable account, previous profile fields and both local cart keys', async t => {
  const api = await app(t);
  const { identityFromClaims } = await import('../functions/api/auth/_profile.js');
  const { linkAccounts } = await import('../functions/api/auth/_links.js');
  const g = await identityFromClaims(google);
  const e = await identityFromClaims(email);
  const fromGoogle = await api.forIdentity(google);
  const fromEmail = await api.forIdentity(email);
  await fromGoogle.save({ avatar: image });
  await fromEmail.save({ name: 'My chosen name' });
  assert.equal(await linkAccounts(api.env, e, g), true);
  assert.equal(await linkAccounts(api.env, e, g), true);
  for (const browser of [fromGoogle, fromEmail]) {
    const { user } = await browser.session();
    assert.equal(user.id, e.id);
    assert.equal(user.name, 'My chosen name');
    assert.equal(user.picture, image);
    assert.deepEqual(user.cartAliases, [g.id]);
    assert.deepEqual(user.linkedProviders, ['email', 'google']);
  }
  await fromGoogle.save({ avatar: '', name: 'Shared' });
  assert.equal((await fromEmail.session()).user.name, 'Shared');
  assert.equal((await fromEmail.session()).user.picture, '');
  const otherGoogle = await identityFromClaims({ ...google, sub: 'different-google-id' });
  assert.equal(await linkAccounts(api.env, e, otherGoogle), false);
  const newAddress = 'other@example.test';
  const replacementEmail = await identityFromClaims({ sub: 'email:' + newAddress, email: newAddress });
  const renamedGoogle = await identityFromClaims({ ...google, email: newAddress });
  assert.equal(await linkAccounts(api.env, replacementEmail, renamedGoogle), false);
  const separate = await api.forIdentity({ ...google, sub: 'different-google-id' });
  assert.notEqual((await separate.session()).user.id, e.id);
});

test('different customized profiles and mismatched addresses stay independent', async t => {
  const api = await app(t);
  const { identityFromClaims } = await import('../functions/api/auth/_profile.js');
  const { linkAccounts } = await import('../functions/api/auth/_links.js');
  const g = await identityFromClaims(google);
  const e = await identityFromClaims(email);
  const fromGoogle = await api.forIdentity(google);
  const fromEmail = await api.forIdentity(email);
  await fromGoogle.save({ name: 'Google Name' });
  await fromEmail.save({ name: 'Mail Name' });
  assert.equal(await linkAccounts(api.env, e, g), false);
  assert.equal(await linkAccounts(api.env, e, { ...g, email: address.toLowerCase() }), false);
  for (const [session, id, name] of [[fromGoogle, g.id, 'Google Name'], [fromEmail, e.id, 'Mail Name']]) {
    const { user } = await session.session();
    assert.equal(user.id, id);
    assert.equal(user.name, name);
    assert.deepEqual(user.linkedProviders, [user.provider]);
  }
});

test('mailbox case equivalence is limited to the same Gmail domain and keeps existing email subject IDs', async () => {
  const { sameLinkMailbox } = await import('../functions/api/auth/email/_shared.js');
  const { identityFromClaims } = await import('../functions/api/auth/_profile.js');
  assert.equal(sameLinkMailbox('Name@Gmail.com', 'name@gmail.com'), true);
  assert.equal(sameLinkMailbox('Name@Googlemail.com', 'name@googlemail.com'), true);
  assert.equal(sameLinkMailbox('Name@googlemail.com', 'name@gmail.com'), false);
  assert.equal(sameLinkMailbox('Na.me@gmail.com', 'name@gmail.com'), false);
  assert.equal(sameLinkMailbox('name+tag@gmail.com', 'name@gmail.com'), false);
  assert.equal(sameLinkMailbox('Name@Example.com', 'name@example.com'), false);
  assert.equal(sameLinkMailbox('Name@Example.com', 'Name@example.com'), true);
  const account = email => identityFromClaims({ sub: 'email:' + email, email });
  assert.notEqual((await account('Name@gmail.com')).id, (await account('name@gmail.com')).id);
});

test('authenticated profile upload times out without changing profile or waiting for cancellation', { timeout: 7000 }, async t => {
  const api = await app(t);
  const { seal } = await import('../functions/api/auth/_lib.js');
  const { onRequestPost } = await import('../functions/api/auth/profile.js');
  const token = await seal({ ...email, exp: Math.floor(Date.now() / 1000) + 120 }, api.env.AUTH_COOKIE_SECRET);
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const response = await onRequestPost({ env: api.env, request: new Request('https://dvnclothing.com/api/auth/profile', {
    method: 'POST', body: stream, duplex: 'half', headers: {
      Cookie: '__Host-dvn-session=' + token, Origin: 'https://dvnclothing.com', 'Content-Type': 'application/json',
    },
  }) });
  assert.equal(response.status, 408);
  assert.deepEqual(await response.json(), { error: 'request_timeout' });
  assert.equal(cancelled, true);
  assert.equal((await (await api.forIdentity(email)).session()).user.name, email.name);
});
