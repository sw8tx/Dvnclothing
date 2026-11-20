const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');

async function app(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(readFileSync(require.resolve('../migrations/0002_profiles.sql'), 'utf8'));
  const env = {
    AUTH_COOKIE_SECRET: 'profile-tests-with-at-least-32-characters',
    RESEND_API_KEY: 'local-mail-provider',
    DVN_AUTH_DB: { prepare(query) {
      const statement = sql.prepare(query);
      return { bind: (...args) => ({ first: async () => statement.get(...args) || null }) };
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
  return { forIdentity };
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
