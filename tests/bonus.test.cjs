const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0003_welcome_bonus', '0004_account_links']) {
    sqlite.exec(fs.readFileSync(require.resolve('../migrations/' + migration + '.sql'), 'utf8'));
  }
  return { sqlite, binding: { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { bind(...args) { return {
      first: async () => statement.get(...args) ?? null,
      run: async () => statement.run(...args),
      all: () => ({ results: statement.all(...args) }),
    }; } };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.all());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  } } };
}

const secret = 'a sufficiently long test-only signing secret';
const site = 'https://dvnclothing.com';

async function context(db, sub, email, method = 'POST', origin = site) {
  const { seal } = await import('../functions/api/auth/_lib.js');
  const exp = Math.floor(Date.now() / 1000) + 500;
  const headers = { Origin: origin };
  if (sub) headers.Cookie = '__Host-dvn-session=' + await seal({ sub, email, exp }, secret);
  return {
    env: { DVN_AUTH_DB: db, AUTH_COOKIE_SECRET: secret },
    request: new Request(site + '/api/account/bonus', { method, headers }),
  };
}

test('parallel claims create one private code per address; only a proven link shares it', async () => {
  const { onRequestGet, onRequestPost } = await import('../functions/api/account/bonus.js');
  const { identity } = await import('../functions/api/auth/_profile.js');
  const { binding, sqlite } = database();
  const google = await context(binding, 'google-sub', 'One@example.com');
  const mail = await context(binding, 'email:one@example.com', 'one@example.com');
  assert.deepEqual(await (await onRequestGet(mail)).json(), { bonus: null });
  const results = await Promise.all([onRequestPost(google), onRequestPost(mail), onRequestPost(google)]);
  const winner = results[0].status === 200 ? google : mail;
  const loser = winner === google ? mail : google;
  assert.equal(results[0].status, results[2].status);
  assert.equal(results.filter(response => response.status === 409).length, winner === google ? 1 : 2);
  const value = await (await onRequestGet(winner)).json();
  assert.equal(value.bonus.percentOff, 15);
  assert.equal(value.bonus.firstOrderOnly, true);
  assert.match(value.bonus.code, /^DVN(?:-[A-Z2-9]{4}){5}$/);
  assert.deepEqual(await (await onRequestGet(loser)).json(), { error: 'account_link_required' });
  assert.deepEqual(await (await onRequestPost(loser)).json(), { error: 'account_link_required' });
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM welcome_bonuses').get().n, 1);

  const g = await identity(google.request, google.env);
  const m = await identity(mail.request, mail.env);
  sqlite.prepare('INSERT INTO account_links (google_id, email_id, default_name) VALUES (?, ?, ?)').run(g.id, m.id, 'Test');
  assert.deepEqual(await (await onRequestGet(loser)).json(), value);
  assert.deepEqual(await (await onRequestPost(loser)).json(), value);
  const other = await context(binding, 'email:other@example.com', 'other@example.com');
  assert.notEqual((await (await onRequestPost(other)).json()).bonus.code, value.bonus.code);
  sqlite.close();
});

test('if a Google address changed before linking, both identities converge on the older code', async () => {
  const { onRequestGet, onRequestPost } = await import('../functions/api/account/bonus.js');
  const { identity } = await import('../functions/api/auth/_profile.js');
  const { binding, sqlite } = database();
  const oldGoogle = await context(binding, 'google-sub', 'old@example.com');
  const mail = await context(binding, 'email:new@example.com', 'new@example.com');
  const older = (await (await onRequestPost(oldGoogle)).json()).bonus;
  sqlite.prepare('UPDATE welcome_bonuses SET created_at = 1').run();
  const newer = (await (await onRequestPost(mail)).json()).bonus;
  assert.notEqual(newer.code, older.code);
  const google = await context(binding, 'google-sub', 'new@example.com');
  const g = await identity(google.request, google.env);
  const m = await identity(mail.request, mail.env);
  sqlite.prepare('INSERT INTO account_links (google_id, email_id, default_name) VALUES (?, ?, ?)').run(g.id, m.id, 'Test');
  assert.deepEqual((await (await onRequestGet(mail)).json()).bonus, older);
  assert.deepEqual((await (await onRequestPost(google)).json()).bonus, older);
  assert.equal(sqlite.prepare('SELECT retired FROM welcome_bonuses WHERE code = ?').get(newer.code).retired, 1);
  assert.deepEqual((await (await onRequestPost(mail)).json()).bonus, older);
  sqlite.close();
});

test('unauthenticated, cross-origin and unavailable database requests fail without issuing codes', async () => {
  const { onRequestGet, onRequestPost } = await import('../functions/api/account/bonus.js');
  const { binding, sqlite } = database();
  assert.equal((await onRequestGet(await context(binding))).status, 401);
  assert.equal((await onRequestPost(await context(binding, 'google-sub', 'a@example.com', 'POST', 'https://elsewhere.test'))).status, 403);
  const outage = await onRequestPost(await context(undefined, 'google-sub', 'a@example.com'));
  assert.equal(outage.status, 503);
  assert.equal(outage.headers.get('Cache-Control'), 'no-store');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM welcome_bonuses').get().n, 0);
  sqlite.close();
});

test('daily D1 limits send a server-relative reset for reads and claims without exposing database errors', async t => {
  const { onRequestGet, onRequestPost } = await import('../functions/api/account/bonus.js');
  const { binding, sqlite } = database();
  t.after(() => sqlite.close());
  const log = t.mock.method(console, 'warn', () => {});
  const clock = t.mock.method(Date, 'now', () => Date.parse('2026-12-31T23:59:59.950Z'));
  const failure = 'Daily D1 rows read limit exceeded: private diagnostics';
  t.mock.method(binding, 'prepare', () => ({ bind: () => ({
    first() { throw Error('D1_ERROR', { cause: Error('D1 failure', { cause: Error(failure) }) }); },
  }) }));
  t.mock.method(binding, 'batch', () => [{ success: false, error: failure }]);
  for (const [method, handler, at, remaining] of [
    ['GET', onRequestGet, '2026-12-31T23:59:59.950Z', '1'],
    ['POST', onRequestPost, '2027-01-01T00:00:00.001Z', '86400'],
  ]) {
    clock.mock.mockImplementation(() => Date.parse(at));
    const response = await handler(await context(binding, 'google-sub', 'member@example.test', method));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'bonus_quota' });
    assert.equal(response.headers.get('Retry-After'), remaining);
    assert.equal(response.headers.get('Date'), new Date(at).toUTCString());
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    ['account_bonus', { stage: 'read', category: 'daily_quota' }],
    ['account_bonus', { stage: 'claim', category: 'daily_quota' }],
  ]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM welcome_bonuses').get().n, 0);
});

test('storage limits, transient service outages and schema failures have no daily reset promise', async t => {
  const { onRequestPost } = await import('../functions/api/account/bonus.js');
  const { binding, sqlite } = database();
  t.after(() => sqlite.close());
  const log = t.mock.method(console, 'warn', () => {});
  const batch = t.mock.method(binding, 'batch');
  for (const [message, category] of [
    ['D1 database unavailable', 'database'],
    ['D1 free tier storage limit exceeded', 'database'],
    ['no such column: sensitive', 'schema'],
  ]) {
    batch.mock.mockImplementation(() => { throw Error(message); });
    const response = await onRequestPost(await context(binding, 'google-sub', 'member@example.test'));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'bonus_unavailable' });
    assert.equal(response.headers.get('Retry-After'), null);
    assert.deepEqual(log.mock.calls.at(-1).arguments, ['account_bonus', { stage: 'claim', category }]);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM welcome_bonuses').get().n, 0);
});

test('sandbox provisioning recovers after Stripe accepted a request but its response was lost', async (t) => {
  const { prepareTestPromotion } = await import('../functions/api/account/_stripe.js');
  const { onRequestPost } = await import('../functions/api/account/bonus.js');
  const { binding, sqlite } = database();
  const env = { DVN_AUTH_DB: binding, STRIPE_TEST_SECRET_KEY: 'sk_test_mock' };
  const session = await context(binding, 'google-sub', 'a@example.com');
  const { bonus: { code } } = await (await onRequestPost(session)).json();
  const objects = {};
  const writes = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer sk_test_mock');
    assert.equal(init.headers['Stripe-Version'], '2026-11-18.endive');
    const { pathname, searchParams } = new URL(url);
    if (init.method === 'GET' && pathname.startsWith('/v1/coupons/')) {
      return Response.json(objects.coupon || {}, { status: objects.coupon ? 200 : 404 });
    }
    if (init.method === 'GET') {
      const obj = pathname === '/v1/customers' ? objects.customer : objects.promo;
      assert.ok(pathname === '/v1/customers' ? searchParams.get('email').endsWith('@example.invalid') : searchParams.get('code') === code);
      return Response.json({ data: obj ? [obj] : [], has_more: false });
    }
    const data = init.body;
    assert.ok(init.headers['Idempotency-Key']);
    writes.push(pathname);
    assert.doesNotMatch(String(data), /a%40example.com/);
    if (pathname === '/v1/coupons') {
      assert.equal(data.get('percent_off'), '15');
      assert.equal(data.get('duration'), 'once');
      objects.coupon = { id: data.get('id'), percent_off: 15, duration: 'once', livemode: false, valid: true };
      return Response.json(objects.coupon);
    }
    if (pathname === '/v1/customers') {
      objects.customer = { id: 'cus_demo', livemode: false, metadata: { dvn_welcome: data.get('metadata[dvn_welcome]') } };
      return Response.json(objects.customer);
    }
    assert.equal(pathname, '/v1/promotion_codes');
    assert.equal(data.get('restrictions[first_time_transaction]'), 'true');
    assert.equal(data.get('max_redemptions'), '1');
    assert.equal(data.get('customer'), 'cus_demo');
    assert.equal(data.get('promotion[type]'), 'coupon');
    assert.equal(data.get('promotion[coupon]'), objects.coupon.id);
    objects.promo = { id: 'promo_demo', code, livemode: false, customer: 'cus_demo', max_redemptions: 1,
      promotion: { type: 'coupon', coupon: objects.coupon.id }, restrictions: { first_time_transaction: true } };
    throw Error('Simulated lost response');
  });
  await assert.rejects(prepareTestPromotion({ ...env, STRIPE_TEST_SECRET_KEY: 'sk_live_mock' }, code));
  await assert.rejects(prepareTestPromotion(env, code));
  assert.equal(sqlite.prepare('SELECT stripe_test_promotion_id AS id FROM welcome_bonuses').get().id, null);
  await prepareTestPromotion(env, code);
  assert.deepEqual(writes, ['/v1/coupons', '/v1/customers', '/v1/promotion_codes']);
  assert.equal(sqlite.prepare('SELECT stripe_test_promotion_id AS id FROM welcome_bonuses').get().id, 'promo_demo');
  sqlite.close();
});

test('retirement disables only the exact matching sandbox promotion and can be retried', async (t) => {
  const { retireTestPromotion } = await import('../functions/api/account/_stripe.js');
  const env = { STRIPE_TEST_SECRET_KEY: 'rk_test_secret' };
  let active = true;
  let updates = 0;
  const code = 'DVN-ABCD-ABCD-ABCD-ABCD-ABCD';
  t.mock.method(global, 'fetch', async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    if (init.method === 'GET') {
      assert.equal(searchParams.get('code'), code);
      return Response.json({ data: [{
        id: 'promo_retired', code, livemode: false, promotion: { coupon: 'dvn_welcome15_once_v1' }, active,
      }], has_more: false });
    }
    assert.equal(pathname, '/v1/promotion_codes/promo_retired');
    assert.equal(init.body.get('active'), 'false');
    assert.ok(init.headers['Idempotency-Key']);
    updates++;
    active = false;
    return Response.json({ active });
  });
  await retireTestPromotion(env, code);
  await retireTestPromotion(env, code);
  assert.equal(updates, 1);
});
