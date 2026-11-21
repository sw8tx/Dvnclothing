const { test } = require('node:test');
const assert = require('node:assert/strict');

const site = 'https://dvnclothing.com';
const secret = 'test-only-security-signing-secret-at-least-32-characters';

test('API rejects unknown paths, unsupported methods and foreign origins before calling handlers', async () => {
  const { onRequest } = await import('../functions/api/_middleware.js');
  let calls = 0;
  const next = async () => { calls++; return Response.json({ ok: true }); };
  for (const [path, method, origin, status] of [
    ['/api/missing', 'GET', site, 404],
    ['/api/auth/_lib', 'GET', site, 404],
    ['/api/auth/logout', 'GET', site, 405],
    ['/api/auth/session', 'POST', site, 405],
    ['/api/auth/start', 'DELETE', site, 405],
    ['/api/auth/profile', 'POST', 'https://attacker.test', 403],
    ['/api/auth/email/start', 'POST', 'null', 403],
    ['/api/account/bonus', 'POST', '', 403],
  ]) {
    const result = await onRequest({ request: new Request(site + path, { method, headers: { Origin: origin } }), next });
    assert.equal(result.status, status);
    assert.match(result.headers.get('Content-Type'), /application\/json/);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    if (status === 405) assert.ok(result.headers.get('Allow'));
  }
  for (const host of ['http://dvnclothing.com', 'https://dvnclothing.com:444', 'https://preview.pages.dev']) {
    assert.equal((await onRequest({ request: new Request(host + '/api/auth/session'), next })).status, 403);
  }
  assert.equal(calls, 0);
  assert.equal((await onRequest({ request: new Request(site + '/api/auth/session'), next })).status, 200);
  assert.equal(calls, 1);
});

test('API applies security headers to redirects and preserves independent cookie clearing instructions', async () => {
  const { onRequest } = await import('../functions/api/_middleware.js');
  const { onRequestPost: logout } = await import('../functions/api/auth/logout.js');
  const request = new Request(site + '/api/auth/logout', { method: 'POST', headers: { Origin: site } });
  const result = await onRequest({ request, next: () => logout({ request }) });
  assert.equal(result.headers.getSetCookie().length, 3);
  for (const cookie of result.headers.getSetCookie()) assert.match(cookie, /Secure; HttpOnly; SameSite=Lax; Max-Age=0$/);
  const redirected = await onRequest({ request: new Request(site + '/api/auth/start'), next: async () => Response.redirect('https://accounts.google.com/', 302) });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get('Location'), 'https://accounts.google.com/');
  for (const response of [result, redirected]) {
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Security-Policy'), /default-src 'none'/);
    assert.match(response.headers.get('Strict-Transport-Security'), /max-age=31536000/);
  }
});

test('unexpected API exceptions never disclose secrets, query parameters or internal diagnostics', async t => {
  const { onRequest } = await import('../functions/api/_middleware.js');
  const log = t.mock.method(console, 'warn', () => {});
  const response = await onRequest({
    request: new Request(site + '/api/auth/session?secret=private-value'),
    next: () => { throw Error('SQL and secret=private-value user@example.test'); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'temporarily_unavailable' });
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [['account_api', { route: '/api/auth/session', category: 'unexpected' }]]);
});

test('guest session reads no database; an outage never represents a linked account as ready to use', async () => {
  const { onRequestGet: session } = await import('../functions/api/auth/session.js');
  const { seal } = await import('../functions/api/auth/_lib.js');
  let calls = 0;
  let available = false;
  const env = { AUTH_COOKIE_SECRET: secret, DVN_AUTH_DB: { prepare() {
    calls++;
    if (!available) throw Error('daily read quota exceeded');
    return { bind: () => ({ first: async () => ({ email_id: 'canonical-email-account', google_id: 'original-google-account', name: 'Saved name', picture: '' }) }) };
  } } };
  const guest = await (await session({ request: new Request(site + '/api/auth/session'), env })).json();
  assert.equal(guest.user, null);
  assert.equal(calls, 0);
  const token = await seal({ sub: 'google-subject', email: 'person@example.test', name: 'Provider name', exp: Math.floor(Date.now() / 1000) + 120 }, secret);
  const request = new Request(site + '/api/auth/session', { headers: { Cookie: '__Host-dvn-session=' + token } });
  const outage = await (await session({ request, env })).json();
  assert.equal(outage.accountAvailable, false);
  assert.equal(outage.profileConfigured, false);
  assert.equal(outage.user.email, 'person@example.test');
  available = true;
  const restored = await (await session({ request, env })).json();
  assert.equal(restored.accountAvailable, true);
  assert.equal(restored.user.id, 'canonical-email-account');
  assert.equal(restored.user.name, 'Saved name');
});

test('OAuth refuses a pending request without PKCE and safely handles provider failures', async t => {
  const { onRequestGet: callback } = await import('../functions/api/auth/callback.js');
  const { seal } = await import('../functions/api/auth/_lib.js');
  const env = { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', AUTH_COOKIE_SECRET: secret };
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new DOMException('private provider message', 'TimeoutError'); });
  for (const verifier of [undefined, 'v'.repeat(43)]) {
    const pending = await seal({ state: 'state', nonce: 'nonce', verifier, exp: Math.floor(Date.now() / 1000) + 120 }, secret);
    const response = await callback({ env, request: new Request(site + '/api/auth/callback?state=state&code=code', {
      headers: { Cookie: '__Host-dvn-pending=' + pending },
    }) });
    assert.equal(response.headers.get('Location'), site + '/?login=failed');
    assert.doesNotMatch(response.headers.get('Set-Cookie'), /__Host-dvn-session=/);
    if (!verifier) assert.equal(fetch.mock.callCount(), 0);
  }
  assert.equal(fetch.mock.callCount(), 1);
});
