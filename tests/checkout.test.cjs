const test = require('node:test');
const assert = require('node:assert/strict');

const site = 'https://dvnclothing.com';
const secret = 'checkout-test-signing-secret-over-32-characters';
const catalog = {
  currency: 'EUR',
  products: [
    { id: 'test-tee', priceCents: 2000, sizes: ['S', 'M', 'L'] },
    { id: 'test-tee-back', priceCents: 2200, sizes: ['S', 'M', 'L'] },
  ],
};
const cart = () => ({ method: 'paypal', items: [{ productId: 'test-tee', size: 'M', quantity: 1 }] });

async function context({ method = 'GET', path = '/api/checkout/config', authenticated = true,
  origin = site, urlOrigin = site, body, headers: extraHeaders = {}, claims = {} } = {}) {
  const { seal } = await import('../functions/api/auth/_lib.js');
  const headers = { Origin: origin, ...extraHeaders };
  if (authenticated) headers.Cookie = '__Host-dvn-session=' + await seal({
    sub: 'google-member', email: 'member@example.test', exp: Math.floor(Date.now() / 1000) + 120,
    ...claims,
  }, secret);
  return {
    env: { AUTH_COOKIE_SECRET: secret, DVN_AUTH_DB: {
      prepare() { throw Error('Checkout readiness must not query or mutate account storage'); },
    } },
    request: new Request(urlOrigin + path, { method, headers, body }),
  };
}

test('checkout readiness requires an unexpired signed identity and the canonical HTTPS host', async t => {
  const { onRequestGet } = await import('../functions/api/checkout/config.js');
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('No provider is authorized'); });
  for (const options of [
    { authenticated: false },
    { claims: { exp: Math.floor(Date.now() / 1000) - 1 } },
    { claims: { sub: 'email:another@example.test' } },
  ]) {
    const response = await onRequestGet(await context(options));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'unauthenticated' });
  }
  for (const urlOrigin of ['http://dvnclothing.com', 'https://dvnclothing.com:444', 'https://www.dvnclothing.com', 'https://preview.pages.dev']) {
    const response = await onRequestGet(await context({ urlOrigin }));
    assert.equal(response.status, 403);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('bonus sandbox keys and arbitrary enable flags never advertise a payment method', async t => {
  const { onRequestGet } = await import('../functions/api/checkout/config.js');
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('No provider is authorized'); });
  const ctx = await context();
  Object.assign(ctx.env, {
    STRIPE_TEST_SECRET_KEY: 'sk_test_private', PAYPAL_CLIENT_SECRET: 'private-paypal-secret',
    CHECKOUT_ENABLED: 'true', SHOPIFY_STOREFRONT_TOKEN: 'private-shopify-token',
  });
  const response = await onRequestGet(ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: false, methods: [], currency: 'EUR', error: 'checkout_not_ready' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(fetch.mock.callCount(), 0);
});

test('cart quotes use server prices and combine duplicates before computing totals', async () => {
  const { normalizeCart } = await import('../functions/api/checkout/_lib.js');
  for (const method of ['paypal', 'card']) {
    const result = normalizeCart({ method, items: [
      { productId: 'test-tee', size: 'M', quantity: 2 },
      { productId: 'test-tee-back', size: 'S', quantity: 1 },
      { productId: 'test-tee', size: 'M', quantity: 3 },
    ] }, catalog);
    assert.deepEqual(result, {
      method, currency: 'EUR', subtotalCents: 12200,
      items: [
        { productId: 'test-tee', size: 'M', quantity: 5, unitPriceCents: 2000 },
        { productId: 'test-tee-back', size: 'S', quantity: 1, unitPriceCents: 2200 },
      ],
    });
  }
});

test('checkout rejects client amounts, credentials, ownership, addresses and redirect destinations', async () => {
  const { normalizeCart } = await import('../functions/api/checkout/_lib.js');
  for (const extra of [
    { priceCents: 1 }, { subtotalCents: 1 }, { discount: 100 }, { shippingCents: 0 },
    { cardNumber: '4111111111111111' }, { paypalPassword: 'private' },
    { userId: 'another-account' }, { email: 'another@example.test' },
    { address: 'private-address' }, { returnUrl: 'https://attacker.test' },
  ]) {
    assert.throws(() => normalizeCart({ ...cart(), ...extra }, catalog), { code: 'invalid_request', status: 400 });
    const value = cart();
    Object.assign(value.items[0], extra);
    assert.throws(() => normalizeCart(value, catalog), { code: 'invalid_cart', status: 400 });
  }
});

test('unknown products and sizes, coercible quantities and duplicate quantity bypasses are rejected', async () => {
  const { normalizeCart } = await import('../functions/api/checkout/_lib.js');
  for (const changes of [
    { productId: 'unknown' }, { productId: '__proto__' }, { size: 'XXXL' }, { size: 'm' },
    { quantity: '1' }, { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 },
    { quantity: 100 }, { quantity: Number.MAX_SAFE_INTEGER }, { quantity: NaN },
  ]) {
    const value = cart();
    Object.assign(value.items[0], changes);
    assert.throws(() => normalizeCart(value, catalog), { code: 'invalid_cart', status: 400 });
  }
  assert.throws(() => normalizeCart({ method: 'paypal', items: [
    { productId: 'test-tee', size: 'M', quantity: 50 },
    { productId: 'test-tee', size: 'M', quantity: 50 },
  ] }, catalog), { code: 'invalid_cart', status: 400 });
  for (const items of [[], Array.from({ length: 31 }, () => cart().items[0]), {}, null]) {
    assert.throws(() => normalizeCart({ method: 'paypal', items }, catalog), { code: 'invalid_cart' });
  }
  for (const value of [null, [], {}, { ...cart(), method: 'unknown' }, { ...cart(), method: null }]) {
    assert.throws(() => normalizeCart(value, catalog), { code: 'invalid_request' });
  }
});

test('an incomplete or inconsistent server catalog cannot produce a payable quote', async () => {
  const { normalizeCart } = await import('../functions/api/checkout/_lib.js');
  for (const invalid of [
    {}, { ...catalog, currency: 'USD' },
    { ...catalog, products: [null] },
    { ...catalog, products: [...catalog.products, catalog.products[0]] },
    ...[0, -1, '2000', 1.1, Number.MAX_SAFE_INTEGER].map(priceCents => ({
      ...catalog, products: [{ ...catalog.products[0], priceCents }],
    })),
  ]) {
    assert.throws(() => normalizeCart(cart(), invalid), { code: 'checkout_not_ready', status: 503 });
  }
});

test('request parser enforces media type, UTF-8, JSON and declared or streamed byte limits', async () => {
  const { readJson } = await import('../functions/api/checkout/_lib.js');
  const request = (body, headers = {}) => new Request(site, {
    method: 'POST', body, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
  assert.deepEqual(await readJson(request(JSON.stringify(cart()))), cart());
  await assert.rejects(readJson(request('{}', { 'Content-Type': 'text/plain' })), { code: 'invalid_request', status: 415 });
  await assert.rejects(readJson(request('not json')), { code: 'invalid_request', status: 400 });
  await assert.rejects(readJson(request(new Uint8Array([0xc3, 0x28]))), { code: 'invalid_request', status: 400 });
  await assert.rejects(readJson(request('{}', { 'Content-Length': '9000' })), { code: 'payload_too_large', status: 413 });
  await assert.rejects(readJson(request(' '.repeat(8193), { 'Content-Length': '2' })), { code: 'payload_too_large', status: 413 });
  await assert.rejects(readJson(new Request(site, { method: 'POST', headers: { 'Content-Type': 'application/json' } })), { code: 'invalid_request' });
});

test('a stalled body is cancelled at the deadline without waiting for client cancellation', async () => {
  const { readJson } = await import('../functions/api/checkout/_lib.js');
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{')); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  const request = new Request(site, { method: 'POST', body, duplex: 'half', headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(readJson(request, { timeoutMs: 10 }), { code: 'request_timeout', status: 408 });
  assert.equal(cancelled, true);
});

test('every real catalog selection remains unavailable until merchant checkout is implemented', async t => {
  const { onRequestPost } = await import('../functions/api/checkout/session.js');
  const actual = require('../catalog.json');
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('No provider is authorized'); });
  assert.equal(actual.products.length, 5);
  assert.deepEqual(actual.products.map(product => product.id), [
    'blue-mirage-black', 'blue-mirage-white', 'define-your-vision', 'blue-sunshine', 'purple-sunshine',
  ]);
  for (const method of ['paypal', 'card']) {
    const ctx = await context({ method: 'POST', path: '/api/checkout/session',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, items: actual.products.map(product => ({
        productId: product.id, size: product.sizes[0], quantity: 1,
      })) }),
    });
    ctx.env.STRIPE_TEST_SECRET_KEY = 'sk_test_private';
    ctx.env.CHECKOUT_ENABLED = 'true';
    const response = await onRequestPost(ctx);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'checkout_not_ready' });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('checkout session rejects guest, foreign-origin, malicious and oversized requests before any provider call', async t => {
  const { onRequestPost } = await import('../functions/api/checkout/session.js');
  const actual = require('../catalog.json');
  const valid = { method: 'paypal', items: [{
    productId: actual.products[0].id, size: actual.products[0].sizes[0], quantity: 1,
  }] };
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('No provider is authorized'); });
  for (const [changes, status, code] of [
    [{ authenticated: false }, 401, 'unauthenticated'],
    [{ origin: 'https://attacker.test' }, 403, 'invalid_origin'],
    [{ origin: 'null' }, 403, 'invalid_origin'],
    [{ origin: '' }, 403, 'invalid_origin'],
    [{ urlOrigin: 'https://www.dvnclothing.com' }, 403, 'invalid_host'],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415, 'invalid_request'],
    [{ body: ' '.repeat(8193) }, 413, 'payload_too_large'],
    [{ body: '{malformed' }, 400, 'invalid_request'],
    [{ body: JSON.stringify({ ...valid, priceCents: 1 }) }, 400, 'invalid_request'],
    [{ body: JSON.stringify({ ...valid, items: [{ ...valid.items[0], quantity: 100 }] }) }, 400, 'invalid_cart'],
  ]) {
    const ctx = await context({ method: 'POST', path: '/api/checkout/session',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid), ...changes,
    });
    const response = await onRequestPost(ctx);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('API middleware exposes only the intended checkout methods and never a helper route', async () => {
  const { onRequest } = await import('../functions/api/_middleware.js');
  const { onRequestGet } = await import('../functions/api/checkout/config.js');
  const ctx = await context();
  const response = await onRequest({ ...ctx, next: () => onRequestGet(ctx) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ready, false);
  let calls = 0;
  const next = async () => { calls++; return Response.json({}); };
  for (const [path, method, status] of [
    ['/api/checkout/config', 'POST', 405],
    ['/api/checkout/session', 'GET', 405],
    ['/api/checkout/session', 'DELETE', 405],
    ['/api/checkout/_lib', 'GET', 404],
  ]) {
    const request = new Request(site + path, { method, headers: { Origin: site } });
    const result = await onRequest({ request, next });
    assert.equal(result.status, status);
  }
  assert.equal(calls, 0);
});
