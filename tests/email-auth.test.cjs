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
    assert.equal(options.redirect, 'manual', 'use a Workers-supported mode that keeps credentials on the Resend origin');
    messages.push(JSON.parse(options.body));
    return typeof provider === 'function' ? provider(options) : Response.json({ id: 'test-id' }, { status: provider });
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
  const code = messages[0].text.match(/DVN-(\d{6})/)[1];
  assert.ok(messages[0].html.includes('DVN-' + code));
  assert.ok(messages[0].html.includes(site + '/assets/brand/dvn-mail-wordmark.png'));
  assert.ok(messages[0].html.includes(site + '/privacy.html'));
  assert.ok(messages[0].text.includes(site + '/impressum.html'));
  assert.ok(!messages[0].subject.includes(code));
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
  const cooldown = await request('start', { email: 'MEMBER@example.test' });
  assert.equal(cooldown.status, 429);
  assert.deepEqual(await cooldown.json(), { error: 'rate_limited' });
  assert.ok(Number(cooldown.headers.get('Retry-After')) >= 59);
  assert.equal(messages.length, 1);
  const code = messages[0].text.match(/DVN-(\d{6})/)[1];
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  for (let i = 0; i < 5; i++) assert.equal((await request('verify', { code: wrong }, cookie)).status, 400);
  assert.equal((await request('verify', { code }, cookie)).status, 400);
  assert.equal(db.prepare('SELECT tries FROM email_login_attempts').get().tries, 5);
  const fresh = await request('start', { email: 'other@example.test' });
  db.exec('UPDATE email_login_attempts SET issued_at = issued_at - 601');
  const other = messages[1].text.match(/DVN-(\d{6})/)[1];
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
    ['email_auth_start', { stage: 'resend', attempt: 1, status: 403, category: 'rejected' }],
  ]);
  const code = messages[0].text.match(/DVN-(\d{6})/)[1];
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
  const code = messages[0].text.match(/DVN-(\d{6})/)[1];
  assert.equal((await request('verify', { code }, challenge)).status, 200);
});

test('an accepted provider response releases the challenge without reading its optional receipt body', async t => {
  const { request, messages } = fixture(t, () => new Response(null, { status: 202 }));
  const response = await request('start', { email: 'member@example.test' });
  assert.equal(response.status, 202);
  assert.ok(response.headers.get('Set-Cookie'));
  assert.equal(messages.length, 1);
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
    ['email_auth_start', { stage: 'reserve', category: 'database' }],
  ]);
});

test('short provider rate limit waits before retrying exactly the same message', async t => {
  const log = t.mock.method(console, 'warn', () => {});
  const schedule = globalThis.setTimeout;
  const waits = [];
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => {
    waits.push(ms);
    return schedule(callback, ms === 1000 ? 0 : ms);
  });
  const deliveries = [];
  const { request } = fixture(t, options => {
    deliveries.push([options.headers['Idempotency-Key'], options.body]);
    return deliveries.length === 1
      ? Response.json({ name: 'rate_limit_exceeded' }, { status: 429, headers: { 'Retry-After': '1' } })
      : Response.json({ id: 'accepted' });
  });
  const result = await request('start', { email: 'member@example.test' });
  assert.equal(result.status, 202);
  assert.ok(result.headers.get('Set-Cookie'));
  assert.deepEqual(waits, [9000, 1000, 9000]);
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries[1], deliveries[0]);
  assert.deepEqual(log.mock.calls[0].arguments[1], { stage: 'resend', attempt: 1, status: 429, category: 'rate_limit' });
});

for (const [status, name, delay, category, error, count] of [
  [307, 'redirect', '0', 'rejected', 'delivery_unavailable', 1],
  [403, 'email_above_quota', '0', 'quota', 'delivery_quota', 1],
  [429, 'monthly_quota_exceeded', '1', 'quota', 'delivery_quota', 1],
  [429, 'daily_quota_exceeded', '0', 'quota', 'delivery_quota', 1],
  [429, 'rate_limit_exceeded', '120', 'rate_limit', 'delivery_busy', 1],
  [409, 'concurrent_idempotent_requests', '0', 'in_progress', 'delivery_unconfirmed', 2],
  [409, 'invalid_idempotent_request', '0', 'rejected', 'delivery_unavailable', 1],
  [503, 'service_unavailable', '0', 'temporary', 'delivery_busy', 2],
]) {
  test('bounds mail retries and withholds the challenge for ' + name, async t => {
    const log = t.mock.method(console, 'warn', () => {});
    const { request, messages } = fixture(t, () => Response.json({ name, message: 'private provider text' }, {
      status, headers: { 'Retry-After': delay },
    }));
    const failed = await request('start', { email: 'member@example.test' });
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error });
    assert.equal(failed.headers.get('Set-Cookie'), null);
    assert.equal(failed.headers.get('Retry-After'), ['delivery_busy', 'delivery_unconfirmed'].includes(error) ? String(Math.max(60, Number(delay))) : null);
    assert.equal(messages.length, count);
    assert.deepEqual(log.mock.calls.map(call => call.arguments[1]), Array.from({ length: count }, (_, i) => ({
      stage: 'resend', attempt: i + 1, status, category,
    })));
  });
}

test('an unconfirmed reservation never sends email', async t => {
  const log = t.mock.method(console, 'warn', () => {});
  const { request, env, messages } = fixture(t);
  t.mock.method(env.DVN_AUTH_DB, 'batch', () => [{ success: false, meta: { changes: 0 } }]);
  const response = await request('start', { email: 'member@example.test' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'reservation_unconfirmed' });
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Retry-After'), null);
  assert.deepEqual(log.mock.calls[0].arguments, ['email_auth_start', { stage: 'reserve', category: 'unconfirmed_write' }]);
  assert.equal(messages.length, 0);
});

for (const stage of ['read', 'write']) {
  test('a confirmed daily D1 ' + stage + ' outage reports midnight and probes again after recovery', async t => {
    const { request, env, messages } = fixture(t);
    t.mock.method(console, 'warn', () => {});
    let now = Date.UTC(2026, 10, 20, 20, 0);
    t.mock.method(Date, 'now', () => now);
    const database = env.DVN_AUTH_DB;
    const prepare = t.mock.method(database, 'prepare');
    const batch = t.mock.method(database, 'batch');
    const operation = stage === 'read' ? prepare : batch;
    operation.mock.mockImplementationOnce(() => { throw Error('D1_ERROR', { cause: Error('daily D1 rows written limit') }); });
    const send = () => request('start', { email: 'member@example.test' });
    for (const seconds of [14400, 14399]) {
      const response = await send();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'store_daily_limit' });
      assert.equal(response.headers.get('Set-Cookie'), null);
      assert.equal(response.headers.get('Retry-After'), String(seconds));
      assert.equal(Date.parse(response.headers.get('Date')) + seconds * 1000, Date.UTC(2026, 10, 21));
      now += 1000;
    }
    assert.equal(operation.mock.callCount(), 1);
    assert.equal(batch.mock.callCount(), stage === 'read' ? 0 : 1);
    assert.equal(messages.length, 0);
    now += 60000;
    assert.equal((await send()).status, 202);
    assert.equal(messages.length, 1);
  });
}

test('the daily outage cache expires at midnight even when discovered seconds before reset', async t => {
  const { request, env } = fixture(t);
  t.mock.method(console, 'warn', () => {});
  let now = Date.UTC(2026, 10, 20, 23, 59, 58);
  t.mock.method(Date, 'now', () => now);
  const batch = t.mock.method(env.DVN_AUTH_DB, 'batch');
  batch.mock.mockImplementationOnce(() => [{ success: false, error: 'D1 free tier daily limit' }]);
  const send = () => request('start', { email: 'member@example.test' });
  const denied = await send();
  assert.equal(denied.headers.get('Retry-After'), '2');
  now += 2000;
  assert.equal((await send()).status, 202);
});

test('ordinary reservation errors do not advertise a daily reset or suppress the next attempt', async t => {
  const { request, env } = fixture(t);
  t.mock.method(console, 'warn', () => {});
  const batch = t.mock.method(env.DVN_AUTH_DB, 'batch');
  batch.mock.mockImplementationOnce(() => { throw Error('database storage quota exceeded'); });
  const send = () => request('start', { email: 'member@example.test' });
  const denied = await send();
  assert.deepEqual(await denied.json(), { error: 'store_quota' });
  assert.equal(denied.headers.get('Retry-After'), null);
  assert.equal((await send()).status, 202);
});

test('pruning is omitted for fresh data and removes expired entries on the next admission', async t => {
  const { request, env, db } = fixture(t);
  const prepare = t.mock.method(env.DVN_AUTH_DB, 'prepare');
  const send = email => request('start', { email });
  assert.equal((await send('first@example.test')).status, 202);
  assert.equal((await send('second@example.test')).status, 202);
  const deletes = () => prepare.mock.calls.filter(call => /^DELETE/i.test(call.arguments[0])).length;
  assert.equal(deletes(), 0);
  db.exec('UPDATE email_login_attempts SET issued_at = issued_at - 3600');
  assert.equal((await send('first@example.test')).status, 202);
  assert.equal(deletes(), 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM email_login_attempts').get().n, 1);
});

test('the indexed mailbox window rejects a sixth hourly request and opens at its exact boundary', async t => {
  const { request, messages } = fixture(t);
  let now = Date.UTC(2026, 10, 20, 18);
  t.mock.method(Date, 'now', () => now);
  const start = () => request('start', { email: 'member@example.test' });
  for (let i = 0; i < 5; i++) {
    assert.equal((await start()).status, 202);
    now += 60000;
  }
  const denied = await start();
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('Retry-After'), '3300');
  now += 3300000;
  assert.equal((await start()).status, 202);
  assert.equal(messages.length, 6);
});

test('competing sends cannot take the last global slot twice', async t => {
  const { request, db, messages } = fixture(t);
  const now = Date.UTC(2026, 10, 20, 18);
  t.mock.method(Date, 'now', () => now);
  const insert = db.prepare('INSERT INTO email_login_attempts(challenge_key, code_mac, email_key, ip_key, issued_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 299; i++) insert.run('c' + i, 'm', 'email' + i, 'ip' + i, now / 1000 - 900);
  const attempts = await Promise.all(['first', 'second'].map(person => request('start', { email: person + '@example.test' })));
  assert.deepEqual(attempts.map(result => result.status).sort(), [202, 429]);
  assert.equal(attempts.find(result => result.status === 429).headers.get('Retry-After'), '2700');
  assert.equal(messages.length, 1);
});

test('a known local cooldown survives an unavailable retry-time lookup', async t => {
  const { request, env, messages } = fixture(t);
  assert.equal((await request('start', { email: 'member@example.test' })).status, 202);
  const prepare = env.DVN_AUTH_DB.prepare.bind(env.DVN_AUTH_DB);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(env.DVN_AUTH_DB, 'prepare', sql => {
    if (sql.includes('AS seconds')) throw Error('timing read unavailable');
    return prepare(sql);
  });
  const denied = await request('start', { email: 'member@example.test' });
  assert.equal(denied.status, 429);
  assert.deepEqual(await denied.json(), { error: 'rate_limited' });
  assert.ok(Number(denied.headers.get('Retry-After')) >= 59);
  assert.equal(denied.headers.get('Set-Cookie'), null);
  assert.equal(messages.length, 1);
});

test('a rapid repeat stays rate limited when D1 writes are unavailable', async t => {
  const { request, env, messages } = fixture(t);
  assert.equal((await request('start', { email: 'member@example.test' })).status, 202);
  t.mock.method(env.DVN_AUTH_DB, 'batch', () => { throw Error('write quota exceeded'); });
  const denied = await request('start', { email: 'MEMBER@example.test' });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('Retry-After')) >= 59);
  assert.equal(messages.length, 1);
});

test('limits mail delivery across different addresses on the same IP', async t => {
  const { request, messages } = fixture(t);
  for (let i = 0; i < 20; i++) {
    assert.equal((await request('start', { email: 'member' + i + '@example.test' })).status, 202);
  }
  const limited = await request('start', { email: 'other@example.test' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) >= 3599);
  assert.equal(messages.length, 20);
});

test('verification reports a database outage separately and permits a retry after recovery', async t => {
  const { request, messages, db, env } = fixture(t);
  const sent = await request('start', { email: 'Member@example.test' });
  const pending = sent.headers.getSetCookie()[0].split(';')[0];
  const code = messages[0].text.match(/DVN-(\d{6})/)[1];
  const log = t.mock.method(console, 'warn', () => {});
  const blocked = t.mock.method(env.DVN_AUTH_DB, 'batch', () => {
    throw Error('D1_ERROR: database unavailable', { cause: Error('daily write quota exceeded: sensitive diagnostics') });
  });
  const unavailable = await request('verify', { code }, pending);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'store_daily_limit' });
  const reset = Date.parse(unavailable.headers.get('Date')) + Number(unavailable.headers.get('Retry-After')) * 1000;
  assert.equal(reset % 86400000, 0);
  assert.equal(unavailable.headers.get('Set-Cookie'), null);
  assert.equal(db.prepare('SELECT tries FROM email_login_attempts').get().tries, 0);
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    ['email_auth_verify', { stage: 'consume', category: 'daily_quota' }],
  ]);
  blocked.mock.restore();
  const verified = await request('verify', { code }, pending);
  assert.equal(verified.status, 200);
  const sessionCookie = verified.headers.getSetCookie().find(header => header.startsWith('__Host-dvn-session=')).split(';')[0];
  const { identity } = await import('../functions/api/auth/_profile.js');
  const user = await identity(new Request(site, { headers: { Cookie: sessionCookie } }), env);
  assert.equal(user.email, 'Member@example.test');
  assert.equal(user.provider, 'email');
  assert.equal((await request('verify', { code }, pending)).status, 400);
});

test('verification with ambiguous D1 metadata never issues a session', async t => {
  const { request, messages, env } = fixture(t);
  const sent = await request('start', { email: 'member@example.test' });
  const pending = sent.headers.getSetCookie()[0].split(';')[0];
  const code = messages[0].text.match(/DVN-(\d{6})/)[1];
  const log = t.mock.method(console, 'warn', () => {});
  t.mock.method(env.DVN_AUTH_DB, 'batch', () => [{ success: true, meta: {} }, { success: true, meta: { changes: 0 } }]);
  const result = await request('verify', { code }, pending);
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('Set-Cookie'), null);
  assert.deepEqual(log.mock.calls[0].arguments, ['email_auth_verify', { stage: 'consume', category: 'unconfirmed_write' }]);
});

test('a matching fifth attempt issues exactly one session', async t => {
  const { request, db, messages } = fixture(t);
  const sent = await request('start', { email: 'member@example.test' });
  const pending = sent.headers.getSetCookie()[0].split(';')[0];
  const code = messages[0].text.match(/DVN-(\d{6})/)[1];
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  for (let i = 0; i < 4; i++) assert.equal((await request('verify', { code: wrong }, pending)).status, 400);
  const requests = await Promise.all([request('verify', { code }, pending), request('verify', { code }, pending)]);
  assert.deepEqual(requests.map(result => result.status).sort(), [200, 400]);
  const row = db.prepare('SELECT tries, consumed FROM email_login_attempts').get();
  assert.equal(row.tries, 5);
  assert.equal(row.consumed, 1);
});

test('linking requires the original signed Google session and a correct code for its own address', async t => {
  const { request, db, messages, env } = fixture(t);
  for (const migration of ['0002_profiles.sql', '0004_account_links.sql']) {
    db.exec(readFileSync(path.join(__dirname, '../migrations', migration), 'utf8'));
  }
  const { seal } = await import('../functions/api/auth/_lib.js');
  const email = 'Member@gmail.com';
  const claims = { sub: 'google-sub-test', email: email.toLowerCase(), name: 'Member', picture: '', exp: Math.floor(Date.now() / 1000) + 600 };
  const google = '__Host-dvn-session=' + await seal(claims, env.AUTH_COOKIE_SECRET);
  const renewed = '__Host-dvn-session=' + await seal({ ...claims, exp: claims.exp + 1 }, env.AUTH_COOKIE_SECRET);
  assert.equal((await request('start', { email, purpose: 'link' })).status, 401);
  assert.equal((await request('start', { email: 'other@example.test', purpose: 'link' }, google)).status, 409);
  assert.equal(messages.length, 0);
  const sent = await request('start', { email: 'Member@GMAIL.COM', purpose: 'link' }, google);
  assert.equal(sent.status, 202);
  assert.deepEqual(messages[0].to, [email]);
  const pending = sent.headers.getSetCookie()[0].split(';')[0];
  const code = messages[0].text.match(/DVN-(\d{6})/)[1];
  assert.equal((await request('verify', { code }, pending)).status, 409);
  assert.equal((await request('verify', { code }, pending + '; ' + renewed)).status, 409);
  assert.equal(db.prepare('SELECT tries FROM email_login_attempts').get().tries, 0);
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  assert.equal((await request('verify', { code: wrong }, pending + '; ' + google)).status, 400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_links').get().n, 0);
  const linked = await request('verify', { code }, pending + '; ' + google);
  assert.equal(linked.status, 200);
  assert.deepEqual(await linked.json(), { linked: true });
  assert.equal(linked.headers.getSetCookie().some(c => c.startsWith('__Host-dvn-session=')), false);
  const { identityFromClaims } = await import('../functions/api/auth/_profile.js');
  const chosen = await identityFromClaims({ sub: 'email:' + email, email });
  assert.equal(db.prepare('SELECT email_id FROM account_links').get().email_id, chosen.id);
  assert.equal((await request('verify', { code }, pending + '; ' + google)).status, 400);
});
