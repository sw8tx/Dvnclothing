const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

const site = 'https://dvnclothing.com';
const env = { AUTH_COOKIE_SECRET: 'test-preview-cookie-secret-with-at-least-32-characters' };
const previewName = '__Host-dvn-preview';
const attemptsName = '__Host-dvn-preview-attempts';
const privateDocuments = {
  '/shop': { body: 'PRIVATE STOREFRONT', type: 'text/html; charset=utf-8' },
  '/product': { body: 'PRIVATE PRODUCT', type: 'text/html; charset=utf-8' },
  '/checkout': { body: 'PRIVATE CHECKOUT', type: 'text/html; charset=utf-8' },
  '/catalog.json': { body: '{"products":["private"]}', type: 'application/json; charset=utf-8' },
};

function request(path, { method = 'GET', cookie = '', origin = site, body, ip, type = 'application/json', host = site, extra = {} } = {}) {
  return new Request(host + path, {
    method,
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': type, ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...extra },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

async function unlock(password, options = {}, settings = env) {
  const { onRequestPost } = await import('../functions/api/preview/unlock.js');
  return onRequestPost({ request: request('/api/preview/unlock', { method: 'POST', body: { password, next: options.next }, ...options }), env: settings });
}

function cookieFrom(response, name = previewName) {
  const value = response.headers.getSetCookie().find(value => value.startsWith(name + '='));
  assert.ok(value, 'Expected cookie ' + name);
  return value.split(';')[0];
}

async function session() { return cookieFrom(await unlock('dvnclothing')); }

function assets() {
  const fetched = [];
  const documents = new Map([
    ['/', 'PUBLIC STATIC LAUNCH'], ['/launch', 'PUBLIC COUNTDOWN'],
    ['/impressum', 'PUBLIC LEGAL'], ['/privacy', 'PUBLIC PRIVACY'],
    ['/terms', 'PUBLIC TERMS'], ['/mail/login/en', 'PUBLIC EMAIL GUIDE'], ['/mail/bonus/de', 'PUBLIC BONUS GUIDE'],
  ]);
  return { fetched, binding: { async fetch(req) {
    const url = new URL(req.url);
    fetched.push({ path: url.pathname, headers: req.headers, method: req.method });
    const document = documents.get(url.pathname);
    if (document) return new Response(req.method === 'HEAD' ? null : document, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ETag: '"private-doc"' },
    });
    if (['/launch.js', '/storefront.js', '/shop.0123456789abcdef.js'].includes(url.pathname)) {
      return new Response('const privateData = true;', { headers: { 'Content-Type': 'application/javascript' } });
    }
    if (url.pathname === '/assets/shop/black.webp') return new Response('private image', { headers: { 'Content-Type': 'image/webp' } });
    // Model Pages fallback behavior rather than returning a convenient 404.
    return new Response('PUBLIC STATIC FALLBACK', { headers: { 'Content-Type': 'text/html' } });
  } } };
}

async function gate(path, { cookie = '', settings = env, fixture = assets(), method = 'GET', extra = {}, pages = privateDocuments } = {}) {
  const { createPreviewMiddleware } = await import('../functions/_middleware.js');
  const onRequest = createPreviewMiddleware(pages);
  return { fixture, response: await onRequest({ request: request(path, { cookie, method, extra }),
    env: { ...settings, ASSETS: fixture.binding }, next: () => { throw Error('Static request escaped gate'); },
  }) };
}

test('the shared password is exact, server checked and creates a 12-hour HttpOnly host cookie without a database', async () => {
  const settings = { ...env, get DVN_AUTH_DB() { throw Error('Preview must not access the account database'); } };
  for (const password of ['DVNCLOTHING', 'dvnclothing ', ' dvnclothing', 'incorrect']) {
    const failed = await unlock(password, {}, settings);
    assert.equal(failed.status, 401);
    assert.deepEqual(await failed.json(), { error: 'invalid_password' });
    assert.equal(failed.headers.getSetCookie().some(value => value.startsWith(previewName + '=')), false);
  }
  const result = await unlock('dvnclothing', {}, settings);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, redirect: '/shop' });
  assert.match(result.headers.getSetCookie().find(value => value.startsWith(previewName + '=')), /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200$/);
  assert.match(result.headers.getSetCookie().find(value => value.startsWith(attemptsName + '=')), /Max-Age=0$/);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  const { hasPreview } = await import('../functions/_preview.js');
  assert.equal(await hasPreview(request('/shop', { cookie: cookieFrom(result) }), settings), true);
});

test('unlock requires the canonical same-site Origin, correct media type, bounded JSON and configured signing', async () => {
  for (const options of [
    { origin: 'https://attacker.test' }, { origin: '' }, { origin: 'null' },
    { host: 'https://www.dvnclothing.com' }, { host: 'https://preview.pages.dev' },
    { host: 'http://dvnclothing.com' }, { host: 'https://dvnclothing.com:444' },
  ]) {
    const result = await unlock('dvnclothing', options);
    assert.equal(result.status, 403);
    assert.equal(result.headers.has('Set-Cookie'), false);
  }
  assert.equal((await unlock('dvnclothing', { type: 'text/plain' })).status, 415);
  for (const body of ['{', '{}', 'null', '[]', JSON.stringify({ password: 123 }), JSON.stringify({ password: 'a'.repeat(3000) })]) {
    assert.equal((await unlock('', { body })).status, 400);
  }
  for (const settings of [{}, { AUTH_COOKIE_SECRET: 'short' }, { ...env, PREVIEW_PASSWORD_SHA256: 'bad' }]) {
    const result = await unlock('dvnclothing', {}, settings);
    assert.equal(result.status, 503);
    assert.equal(result.headers.has('Set-Cookie'), false);
  }
});

test('signed preview access expires, rejects tampering, binds the host and is not a customer-account credential', async t => {
  const tokenCookie = await session();
  const { hasPreview } = await import('../functions/_preview.js');
  const { seal } = await import('../functions/api/auth/_lib.js');
  assert.equal(await hasPreview(request('/shop', { cookie: tokenCookie + 'bad' }), env), false);
  assert.equal(await hasPreview(request('/shop', { cookie: tokenCookie, host: 'https://www.dvnclothing.com' }), env), false);
  const customerToken = await seal({ sub: 'customer', email: 'person@example.test', exp: Math.floor(Date.now() / 1000) + 300 }, env.AUTH_COOKIE_SECRET);
  assert.equal(await hasPreview(request('/shop', { cookie: previewName + '=' + customerToken }), env), false);
  const failed = await unlock('wrong');
  const renamedAttempts = cookieFrom(failed, attemptsName).replace(attemptsName, previewName);
  assert.equal(await hasPreview(request('/shop', { cookie: renamedAttempts }), env), false);
  const { onRequestGet: accountSession } = await import('../functions/api/auth/session.js');
  const response = await accountSession({ request: request('/api/auth/session', {
    cookie: tokenCookie.replace(previewName, '__Host-dvn-session'),
  }), env });
  assert.equal((await response.json()).user, null);
  const future = Date.now() + 12 * 60 * 60 * 1000 + 1000;
  t.mock.method(Date, 'now', () => future);
  assert.equal(await hasPreview(request('/shop', { cookie: tokenCookie }), env), false);
  const expiredCatalog = (await gate('/catalog.json', { cookie: tokenCookie })).response;
  assert.equal(expiredCatalog.status, 401);
  assert.deepEqual(await expiredCatalog.json(), { error: 'preview_required' });
});

test('password parsing cancels stalled or oversized streams without waiting for an unresponsive sender', async () => {
  const { readPreviewBody } = await import('../functions/_preview.js');
  let cancelled = 0;
  const stalled = new Request(site + '/api/preview/unlock', { method: 'POST', duplex: 'half', body: new ReadableStream({
    cancel() { cancelled++; return new Promise(() => {}); },
  }) });
  assert.equal(await readPreviewBody(stalled, 10), null);
  assert.equal(cancelled, 1);
  const oversized = new Request(site + '/api/preview/unlock', { method: 'POST', duplex: 'half', body: new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2049)); },
    cancel() { cancelled++; return new Promise(() => {}); },
  }) });
  assert.equal(await readPreviewBody(oversized), null);
  assert.equal(cancelled, 2);
});

test('an environment hash overrides the default password and revokes previous preview cookies', async () => {
  const previous = await session();
  const settings = { ...env, PREVIEW_PASSWORD_SHA256: createHash('sha256').update('a different preview password').digest('hex') };
  assert.equal((await unlock('dvnclothing', {}, settings)).status, 401);
  const next = await unlock('a different preview password', {}, settings);
  assert.equal(next.status, 200);
  const { hasPreview } = await import('../functions/_preview.js');
  assert.equal(await hasPreview(request('/shop', { cookie: previous }), settings), false);
  assert.equal(await hasPreview(request('/shop', { cookie: cookieFrom(next) }), settings), true);
});

test('failed attempts impose a signed cooldown and a bounded IP budget also survives cookie deletion', async () => {
  let cookie = '';
  for (let i = 0; i < 5; i++) {
    const result = await unlock('wrong', { cookie });
    assert.equal(result.status, i === 4 ? 429 : 401);
    cookie = cookieFrom(result, attemptsName);
  }
  const blocked = await unlock('dvnclothing', { cookie });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(blocked.headers.get('Cache-Control'), 'no-store');
  assert.equal(blocked.headers.getSetCookie().some(value => value.startsWith(previewName + '=')), false);
  for (let i = 0; i < 5; i++) await unlock('wrong', { ip: '192.0.2.55' });
  const noCookies = await unlock('dvnclothing', { ip: '192.0.2.55' });
  assert.equal(noCookies.status, 429);
  assert.equal((await unlock('dvnclothing', { ip: '192.0.2.56' })).status, 200);
});

test('unlock return paths remain on known storefront routes; preview logout leaves customer login cookies alone', async () => {
  for (const next of ['//attacker.test', 'https://attacker.test', '/\\attacker.test', '/api/auth/logout', '/launch', '/shop%2f%2fattacker.test']) {
    assert.equal((await (await unlock('dvnclothing', { next })).json()).redirect, '/shop');
  }
  for (const next of ['/products/ink-black?size=M', '/checkout', '/shop?lang=en']) {
    assert.equal((await (await unlock('dvnclothing', { next })).json()).redirect, next);
  }
  const { onRequestPost: logout } = await import('../functions/api/preview/logout.js');
  assert.equal((await logout({ request: request('/api/preview/logout', { method: 'POST', origin: 'https://attacker.test' }), env })).status, 403);
  const response = await logout({ request: request('/api/preview/logout', { method: 'POST' }), env });
  assert.equal(response.status, 204);
  assert.deepEqual(response.headers.getSetCookie().map(value => value.split('=')[0]).sort(), [previewName, attemptsName].sort());
  for (const value of response.headers.getSetCookie()) assert.match(value, /Max-Age=0$/);
});

test('guests get the countdown first and cannot fetch storefront, product, checkout, catalog or private assets directly', async () => {
  const home = await gate('/');
  assert.equal(home.response.status, 200);
  assert.equal(await home.response.text(), 'PUBLIC COUNTDOWN');
  assert.equal(home.response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(home.response.headers.get('Vary'), 'Cookie');
  for (const path of ['/shop', '/shop/', '/shop.html', '/index', '/index.html', '/products/ink-black', '/product.html', '/checkout', '/checkout.html']) {
    const { response, fixture } = await gate(path);
    assert.equal(response.status, 302, path);
    assert.equal(new URL(response.headers.get('Location')).pathname, '/');
    assert.equal(new URL(response.headers.get('Location')).searchParams.get('preview'), 'required');
    assert.equal(fixture.fetched.length, 0);
  }
  for (const path of ['/catalog.json', '/shop.0123456789abcdef.js', '/storefront.js', '/storefront.css', '/store-cart.js', '/assets/shop/black.webp', '/assets/products/blue-mirage-black.webp', '/assets/lookbook/hero.webp']) {
    const { response, fixture } = await gate(path);
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).error, 'preview_required');
    assert.equal(fixture.fetched.length, 0);
  }
  for (const path of ['/missing', '/%69ndex.html', '/assets/private.html', '/assets/brand/catalog.json', '/catalog.json/']) {
    const { response, fixture } = await gate(path);
    assert.equal(response.status, 404, path);
    assert.equal(fixture.fetched.length, 0);
  }
});

test('valid preview sessions serve the intended documents and disable all shared and browser caching', async () => {
  const cookie = await session();
  for (const [path, body] of [
    ['/', 'PRIVATE STOREFRONT'], ['/shop', 'PRIVATE STOREFRONT'],
    ['/index.html', 'PRIVATE STOREFRONT'], ['/products/ink-black', 'PRIVATE PRODUCT'],
    ['/checkout', 'PRIVATE CHECKOUT'], ['/catalog.json', '{"products":["private"]}'],
  ]) {
    const { response, fixture } = await gate(path, { cookie, extra: { 'If-None-Match': '"old"', 'If-Modified-Since': 'yesterday' } });
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), body);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Vary'), 'Cookie');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    assert.equal(response.headers.has('ETag'), false);
    assert.equal(fixture.fetched.length, 0, 'Protected documents never use the public static binding');
  }
  const code = await gate('/storefront.js', { cookie, extra: { 'If-None-Match': '"old"', 'If-Modified-Since': 'yesterday' } });
  assert.equal(code.response.status, 200);
  assert.equal(code.response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(code.fixture.fetched[0].headers.has('Cookie'), false);
  assert.equal(code.fixture.fetched[0].headers.has('If-None-Match'), false);
  assert.equal(code.fixture.fetched[0].headers.has('If-Modified-Since'), false);
  assert.equal((await gate('/assets/shop/black.webp', { cookie })).response.status, 200);
  const head = (await gate('/shop', { cookie, method: 'HEAD' })).response;
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('missing private build data fails closed and never falls back to static pages, even with valid preview access', async () => {
  const cookie = await session();
  for (const pages of [{}, { '/shop': { body: 'broken', type: 'text/plain' } }]) {
    for (const path of ['/shop', '/products/ink-black', '/checkout', '/catalog.json']) {
      const { response, fixture } = await gate(path, { cookie, pages });
      assert.equal(response.status, 503, path);
      assert.equal(fixture.fetched.length, 0);
      assert.doesNotMatch(await response.text(), /PUBLIC|PRIVATE/);
    }
  }
});

test('public legal and email pages remain reachable, while missing public assets cannot leak the SPA fallback', async () => {
  for (const path of ['/launch', '/launch.html', '/impressum', '/impressum.html', '/privacy.html', '/terms.html', '/mail/login/en', '/mail/bonus/de.html']) {
    const { response } = await gate(path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /^PUBLIC /);
  }
  assert.equal((await gate('/launch.js')).response.status, 200);
  for (const path of ['/launch.ffffffffffffffff.js', '/assets/brand/missing.png', '/assets/fonts/missing.woff2']) {
    const { response } = await gate(path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /STOREFRONT/);
  }
  assert.equal((await gate('/shop', { settings: {} })).response.status, 302);
  assert.equal((await gate('/', { settings: {} })).response.status, 200);
  assert.equal((await gate('/shop', { method: 'POST' })).response.status, 405);
});

test('the gate defers existing API authentication and routes all pages through middleware with only exact public asset exclusions', async () => {
  const { onRequest } = await import('../functions/_middleware.js');
  let calls = 0;
  const response = await onRequest({ request: request('/api/auth/session'), env,
    next: () => { calls++; return Response.json({ user: null }); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { user: null });
  const checkout = { request: request('/api/checkout/config'), env,
    next: () => { calls++; return Response.json({ error: 'unauthenticated' }, { status: 401 }); },
  };
  const locked = await onRequest(checkout);
  assert.equal(locked.status, 401);
  assert.deepEqual(await locked.json(), { error: 'preview_required' });
  assert.equal(calls, 1);
  checkout.request = request('/api/checkout/config', { cookie: await session() });
  const unlocked = await onRequest(checkout);
  assert.equal(unlocked.status, 401);
  assert.deepEqual(await unlocked.json(), { error: 'unauthenticated' });
  assert.equal(calls, 2);
  const routes = JSON.parse(readFileSync(require.resolve('../_routes.json'), 'utf8'));
  assert.deepEqual(routes.include, ['/*']);
  assert.ok(routes.exclude.length > 0);
  for (const route of routes.exclude) {
    assert.doesNotMatch(route, /\*|\.html$|\.json$|\/shop|\/products|\/checkout|\/storefront/);
    assert.match(route, /\.(?:css|js|png|svg|woff2|txt)$/);
  }
});
