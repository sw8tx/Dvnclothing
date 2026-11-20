const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const site = 'https://dvnclothing.com';

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const file of ['0003_welcome_bonus.sql', '0004_account_links.sql', '0005_bonus_email.sql']) {
    db.exec(readFileSync(require.resolve('../migrations/' + file), 'utf8'));
  }
  const env = {
    AUTH_COOKIE_SECRET: 'test-only signing secret with more than 32 chars',
    RESEND_API_KEY: 'test',
    DVN_AUTH_DB: { async batch(queries) {
      db.exec('BEGIN');
      try {
        const result = [];
        for (const query of queries) {
          const rows = await query.all();
          const count = db.prepare('SELECT changes() AS n').get().n;
          result.push({ results: rows, meta: { changes: count } });
        }
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }, prepare(sql) {
      const query = db.prepare(sql);
      return { bind(...args) { return {
        run: async () => ({ meta: { changes: query.run(...args).changes } }), first: async () => query.get(...args), all: async () => query.all(...args),
      }; } };
    } },
  };
  const { seal } = await import('../functions/api/auth/_lib.js');
  const email = 'verified@example.test';
  const signed = await seal({ email, sub: 'email:' + email, exp: Date.now() / 1000 + 1000 }, env.AUTH_COOKIE_SECRET);
  const ctx = (lang = 'en', cookie = signed, origin = site) => ({
    env, request: new Request(site + '/api/account/bonus-email', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: '__Host-dvn-session=' + cookie },
      body: JSON.stringify({ language: lang, to: 'ignored@example.test' }),
    }),
  });
  const handler = (await import('../functions/api/account/bonus-email.js')).onRequestPost;
  const claim = (await import('../functions/api/account/bonus.js')).onRequestPost;
  return { db, ctx, email, env, send: (...args) => handler(ctx(...args)), claim: () => claim(ctx()) };
}

test('requires an explicit action from the authenticated owner of a claimed code', async t => {
  const x = await fixture(t);
  const send = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  assert.equal((await x.send('en', '')).status, 401);
  assert.equal((await x.send('de', '', 'https://elsewhere.test')).status, 403);
  assert.equal((await x.send()).status, 409);
  const { bonus } = await (await x.claim()).json();
  const { seal } = await import('../functions/api/auth/_lib.js');
  const otherProvider = await seal({ sub: 'unlinked-google-subject', email: x.email, exp: Date.now() / 1000 + 1000 }, x.env.AUTH_COOKIE_SECRET);
  const denied = await x.send('en', otherProvider);
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).error, 'account_link_required');
  assert.equal(send.mock.callCount(), 0);
  const results = await Promise.all([x.send(), x.send()]);
  assert.ok(results.some(r => r.status === 200));
  assert.equal((await x.send('de')).status, 200);
  assert.equal(send.mock.callCount(), 1);
  const [url, options] = send.mock.calls[0].arguments;
  assert.equal(url, 'https://api.resend.com/emails');
  const body = JSON.parse(options.body);
  assert.deepEqual(body.to, [x.email]);
  assert.ok(body.html.includes(bonus.code));
  assert.ok(body.text.includes('15%'));
  assert.ok(body.html.includes('/privacy.html'));
  assert.equal(x.db.prepare('SELECT pending_message FROM welcome_bonus_mail').get().pending_message, null);
});

test('an ambiguous send retries its exact original payload inside the idempotency window only', async t => {
  const x = await fixture(t);
  await x.claim();
  const send = t.mock.method(globalThis, 'fetch', async () => { throw new Error('lost response'); });
  assert.equal((await x.send('de')).status, 503);
  assert.equal((await x.send('en')).status, 503);
  assert.equal(send.mock.callCount(), 1);
  x.db.exec('UPDATE welcome_bonus_mail SET lease_until = 0');
  assert.equal((await x.send('en')).status, 503);
  assert.equal(send.mock.callCount(), 2);
  const [a,b] = send.mock.calls.map(c => c.arguments[1]);
  assert.equal(a.body, b.body);
  assert.ok(JSON.parse(b.body).text.includes('15 %'));
  assert.equal(a.headers['Idempotency-Key'], b.headers['Idempotency-Key']);
  x.db.exec('UPDATE welcome_bonus_mail SET started_at = 0, lease_until = 0');
  assert.equal((await x.send()).status, 503);
  assert.equal(send.mock.callCount(), 2);
  assert.equal(x.db.prepare('SELECT pending_message FROM welcome_bonus_mail').get().pending_message, null);
});
