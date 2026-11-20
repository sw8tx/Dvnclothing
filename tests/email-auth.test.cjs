const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const site = 'https://dvnclothing.com';
function fixture(t, provider = 200) {
  // Use the production SQL and SQLite constraints, with D1's binding surface.
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(path.join(__dirname, '../migrations/0001_email_signin.sql'), 'utf8'));
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          return {
            run: () => ({ meta: { changes: statement.run(...values).changes } }),
            first: () => statement.get(...values) ?? null,
          };
        },
      };
    },
    batch(queries) {
      sqlite.exec('BEGIN');
      try {
        const results = queries.map(query => query.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const env = { DVN_AUTH_DB: db, RESEND_API_KEY: 'test-sender', AUTH_COOKIE_SECRET: 'test-cookie-signing-key-at-least-32-bytes' };
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization, 'Bearer test-sender');
    messages.push(JSON.parse(options.body));
    return typeof provider === 'function' ? provider(options) : Response.json({}, { status: provider });
  });
  async function request(method, data, cookie = '', origin = site) {
    const { onRequestPost } = await import('../functions/api/auth/email/' + method + '.js');
    return onRequestPost({
      request: new Request(site + '/api/auth/email/' + method, {
        method: 'POST', headers: {
          'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'CF-Connecting-IP': '192.0.2.4',
        }, body: JSON.stringify(data),
      }), env,
    });
  }
  return { db: sqlite, env, messages, request };
}

test('a mailed code only works once in the requesting browser', async t => {
  const { request, messages, db, env } = fixture(t);
  const sent = await request('start', { email: 'member@example.test', language: 'en' });
  assert.equal(sent.status, 202);
  assert.deepEqual(await sent.json(), { sent: true });
  const pending = sent.headers.getSetCookie()[0];
  assert.match(pending, /Secure; HttpOnly; SameSite=Lax; Max-Age=600/);
  const challenge = pending.split(';')[0];
  assert.equal(messages[0].from, 'DVN CLOTHING <account@dvnclothing.com>');
  assert.deepEqual(messages[0].to, ['member@example.test']);
  const code = messages[0].text.match(/Your DVN sign-in code is (\d{6})/)[1];
  const row = db.prepare('SELECT * FROM email_login_attempts').get();
  assert.notEqual(row.code_mac, code);
  assert.notEqual(row.email_key, 'member@example.test');
  assert.notEqual(row.ip_key, '192.0.2.4');
  assert.equal((await request('verify', { code })).status, 400);
  const responses = await Promise.all([request('verify', { code }, challenge), request('verify', { code }, challenge)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  const ok = responses.find(response => response.status === 200);
  assert.equal((await ok.json()).user.email, 'member@example.test');
  const { unseal } = await import('../functions/api/auth/_lib.js');
  const session = ok.headers.getSetCookie().find(cookie => cookie.startsWith('__Host-dvn-session='));
  assert.equal((await unseal(session.split(';')[0].slice('__Host-dvn-session='.length), env.AUTH_COOKIE_SECRET)).sub, 'email:member@example.test');
  assert.equal(await unseal(challenge.slice('__Host-dvn-email-challenge='.length), env.AUTH_COOKIE_SECRET), null);
});

test('email cooldown, attempt exhaustion, and expiry prohibit further use', async t => {
  const { request, messages, db } = fixture(t);
  const first = await request('start', { email: 'member@example.test' });
  const cookie = first.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await request('start', { email: 'MEMBER@example.test' })).status, 429);
  assert.equal(messages.length, 1);
  const code = messages[0].text.match(/lautet (\d{6})/)[1];
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  for (let i = 0; i < 5; i++) assert.equal((await request('verify', { code: wrong }, cookie)).status, 400);
  assert.equal((await request('verify', { code }, cookie)).status, 400);
  assert.equal(db.prepare('SELECT tries FROM email_login_attempts').get().tries, 5);
  const fresh = await request('start', { email: 'other@example.test' });
  db.exec('UPDATE email_login_attempts SET issued_at = issued_at - 601');
  const other = messages[1].text.match(/lautet (\d{6})/)[1];
  assert.equal((await request('verify', { code: other }, fresh.headers.getSetCookie()[0].split(';')[0])).status, 400);
});

test('rejects cross-site or malformed requests and fails closed on sender failure', async t => {
  const log = t.mock.method(console, 'warn', () => {});
  const { request, messages, db } = fixture(t, 403);
  assert.equal((await request('start', { email: 'member@example.test' }, '', 'https://example.test')).status, 403);
  assert.equal((await request('start', { email: 'bad\naddress@example.test' })).status, 400);
  assert.equal(messages.length, 0);
  const result = await request('start', { email: 'member@example.test' });
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('Set-Cookie'), null);
  assert.equal(db.prepare('SELECT count(*) AS count FROM email_login_attempts').get().count, 1);
  assert.equal(messages.length, 1);
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    ['email_auth_start', { stage: 'resend', attempt: 1, status: 403 }],
  ]);
  const code = messages[0].text.match(/lautet (\d{6})/)[1];
  assert.equal((await request('verify', { code })).status, 400);
});

test('provider acceptance needs no further D1 writes to release a usable browser challenge', async t => {
  const { request, env, messages, db } = fixture(t, () => {
    assert.equal(db.prepare('SELECT active FROM email_login_attempts').get().active, 1);
    t.mock.method(env.DVN_AUTH_DB, 'prepare', () => { throw new Error('D1 is unavailable'); });
    return Response.json({ id: 'message-id' });
  });
  const sent = await request('start', { email: 'member@example.test' });
  assert.equal(sent.status, 202);
  const challenge = sent.headers.getSetCookie()[0].split(';')[0];
  env.DVN_AUTH_DB.prepare.mock.restore();
  const code = messages[0].text.match(/lautet (\d{6})/)[1];
  assert.equal((await request('verify', { code }, challenge)).status, 200);
});

test('a lost provider response retries the identical delivery and logs only the failure stage', async t => {
  const log = t.mock.method(console, 'warn', () => {});
  const deliveries = [];
  const { request } = fixture(t, options => {
    deliveries.push([options.headers['Idempotency-Key'], options.body]);
    if (deliveries.length === 1) throw Error('provider included sensitive recipient metadata');
    return Response.json({ id: 'same-message-id' });
  });
  const sent = await request('start', { email: 'member@example.test' });
  assert.equal(sent.status, 202);
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries[0], deliveries[1]);
  assert.match(deliveries[0][0], /^dvn-login-[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    ['email_auth_start', { stage: 'resend', attempt: 1, category: 'transport' }],
  ]);
});

test('a failed D1 reservation logs its stage and never contacts Resend', async t => {
  const log = t.mock.method(console, 'warn', () => {});
  const { request, env, messages } = fixture(t);
  t.mock.method(env.DVN_AUTH_DB, 'batch', () => { throw Error('sensitive SQL message'); });
  const failed = await request('start', { email: 'member@example.test' });
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('Set-Cookie'), null);
  assert.equal(messages.length, 0);
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    ['email_auth_start', { stage: 'reserve', category: 'internal' }],
  ]);
});

test('limits mail delivery across different addresses on the same IP', async t => {
  const { request, messages } = fixture(t);
  for (let i = 0; i < 20; i++) {
    assert.equal((await request('start', { email: 'member' + i + '@example.test' })).status, 202);
  }
  assert.equal((await request('start', { email: 'other@example.test' })).status, 429);
  assert.equal(messages.length, 20);
});
