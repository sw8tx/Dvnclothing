const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');

globalThis.crypto ??= webcrypto;
const env = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', AUTH_COOKIE_SECRET: 'a-long-test-secret-with-more-than-32-characters' };

test('Google redirect uses state and nonce and rejects a forged callback', async () => {
  const { onRequestGet: start } = await import('../functions/api/auth/start.js');
  const { onRequestGet: callback } = await import('../functions/api/auth/callback.js');
  const request = new Request('https://dvnclothing.com/api/auth/start');
  const response = await start({ request, env });
  assert.equal(response.status, 302);
  const authorization = new URL(response.headers.get('Location'));
  assert.equal(authorization.hostname, 'accounts.google.com');
  assert.equal(authorization.searchParams.get('redirect_uri'), 'https://dvnclothing.com/api/auth/callback');
  assert.equal(authorization.searchParams.get('scope'), 'openid email profile');
  assert.ok(authorization.searchParams.get('nonce'));
  assert.ok(authorization.searchParams.get('state'));
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  const { unseal } = await import('../functions/api/auth/_lib.js');
  const pending = response.headers.get('Set-Cookie');
  const pendingData = await unseal(pending.split(';')[0].split('=')[1], env.AUTH_COOKIE_SECRET);
  assert.match(pendingData.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pendingData.verifier))).toString('base64url'), authorization.searchParams.get('code_challenge'));
  assert.notEqual(pendingData.verifier, authorization.searchParams.get('code_challenge'));
  assert.equal(authorization.searchParams.has('code_verifier'), false);
  assert.match(pending, /Secure; HttpOnly; SameSite=Lax/);
  const forged = await callback({
    request: new Request('https://dvnclothing.com/api/auth/callback?code=fake&state=forged', {
      headers: { Cookie: pending.split(';')[0] },
    }), env,
  });
  assert.equal(forged.status, 302);
  assert.equal(forged.headers.get('Location'), 'https://dvnclothing.com/?login=failed');
  assert.doesNotMatch(forged.headers.get('Set-Cookie'), /__Host-dvn-session/);
});

test('sessions reject tampering and logout requires the site origin', async () => {
  const { seal, unseal } = await import('../functions/api/auth/_lib.js');
  const { onRequestGet: session } = await import('../functions/api/auth/session.js');
  const { onRequestPost: logout } = await import('../functions/api/auth/logout.js');
  const token = await seal({ exp: Math.floor(Date.now() / 1000) + 120, sub: 'test-taylor-google-id', name: 'Taylor', email: 'taylor@example.com' }, env.AUTH_COOKIE_SECRET);
  assert.equal((await unseal(token, env.AUTH_COOKIE_SECRET)).name, 'Taylor');
  assert.equal(await unseal(token + 'tampered', env.AUTH_COOKIE_SECRET), null);
  const response = await session({ request: new Request('https://dvnclothing.com/api/auth/session', { headers: { Cookie: `__Host-dvn-session=${token}` } }), env });
  assert.equal((await response.json()).user.email, 'taylor@example.com');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const forged = await logout({ request: new Request('https://dvnclothing.com/api/auth/logout', { method: 'POST', headers: { Origin: 'https://other.example' } }) });
  assert.equal(forged.status, 403);
  const valid = await logout({ request: new Request('https://dvnclothing.com/api/auth/logout', { method: 'POST', headers: { Origin: 'https://dvnclothing.com' } }) });
  assert.equal(valid.status, 204);
  assert.match(valid.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.deepEqual(valid.headers.getSetCookie().map(value => value.split('=')[0]).sort(),
    ['__Host-dvn-email-challenge', '__Host-dvn-pending', '__Host-dvn-session']);
  for (const host of ['http://dvnclothing.com', 'https://www.dvnclothing.com', 'https://dvnclothing.com:444', 'https://other.example']) {
    const rejected = await logout({ request: new Request(host + '/api/auth/logout', {
      method: 'POST', headers: { Origin: 'https://dvnclothing.com' },
    }) });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.has('Set-Cookie'), false);
  }
});

test('a verified Google callback exchanges the code and creates a usable session', async (t) => {
  const { onRequestGet: start, onRequestPost: startLink } = await import('../functions/api/auth/start.js');
  const { onRequestGet: callback } = await import('../functions/api/auth/callback.js');
  const { onRequestGet: session } = await import('../functions/api/auth/session.js');
  const site = 'https://dvnclothing.com';
  const startResponse = await start({ request: new Request(site + '/api/auth/start'), env });
  const authorization = new URL(startResponse.headers.get('Location')).searchParams;
  const now = Math.floor(Date.now() / 1000);
  const signingKeys = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', signingKeys.publicKey);
  const header = { alg: 'RS256', kid: 'test-key' };
  const profile = { name: 'Alex', email: 'alex@gmail.com', picture: '' };
  const claims = {
    ...profile, iss: 'https://accounts.google.com', sub: 'test-subject', aud: env.GOOGLE_CLIENT_ID,
    nonce: authorization.get('nonce'), iat: now, exp: now + 300, email_verified: true,
  };
  async function signClaims(values) {
    const payload = [header, values].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKeys.privateKey, Buffer.from(payload));
    return payload + '.' + Buffer.from(signature).toString('base64url');
  }
  let idToken = await signClaims(claims);
  let expectedChallenge = authorization.get('code_challenge');
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('code'), 'test-authorization-code');
      assert.equal(options.body.get('redirect_uri'), authorization.get('redirect_uri'));
      assert.equal(options.body.get('client_id'), env.GOOGLE_CLIENT_ID);
      assert.equal(options.body.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
      assert.equal(options.body.get('grant_type'), 'authorization_code');
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      assert.match(options.body.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.body.get('code_verifier')))).toString('base64url'), expectedChallenge);
      return Response.json({ id_token: idToken });
    }
    assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ keys: [{ ...publicKey, kid: header.kid, use: 'sig' }] });
  });

  const callbackUrl = new URL(authorization.get('redirect_uri'));
  callbackUrl.search = new URLSearchParams({
    code: 'test-authorization-code', state: authorization.get('state'),
  }).toString();
  const response = await callback({ request: new Request(callbackUrl, {
    headers: { Cookie: startResponse.headers.get('Set-Cookie').split(';')[0] },
  }), env });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), site + '/?login=complete');
  assert.equal(fetchMock.mock.callCount(), 2);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some(cookie => cookie.startsWith('__Host-dvn-pending=;') && cookie.endsWith('Max-Age=0')));
  const sessionCookie = cookies.find(cookie => cookie.startsWith('__Host-dvn-session='));
  assert.match(sessionCookie, /Path=\/; Secure; HttpOnly; SameSite=Lax/);
  const currentSession = await session({ request: new Request(site + '/api/auth/session', {
    headers: { Cookie: sessionCookie.split(';')[0] },
  }), env });
  const result = await currentSession.json();
  assert.equal(result.configured, true);
  assert.equal(result.emailConfigured, false);
  assert.equal(result.profileConfigured, false);
  const { id, provider, linkedProviders, cartAliases, ...user } = result.user;
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(provider, 'google');
  assert.deepEqual(linkedProviders, ['google']);
  assert.deepEqual(cartAliases, []);
  assert.deepEqual(user, profile);

  // The user is signed in by email, requests linking, then completes Google OAuth.
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  for (const migration of ['0002_profiles.sql', '0004_account_links.sql']) {
    sql.exec(readFileSync(require.resolve('../migrations/' + migration), 'utf8'));
  }
  const connectedEnv = { ...env, DVN_AUTH_DB: { prepare(query) {
    const stmt = sql.prepare(query);
    return { bind: (...args) => ({
      first: async () => stmt.get(...args) || null,
      run: async () => ({ meta: { changes: stmt.run(...args).changes } }),
    }) };
  } } };
  const { seal } = await import('../functions/api/auth/_lib.js');
  const emailClaims = { sub: 'email:Alex@gmail.com', email: 'Alex@gmail.com', exp: now + 120 };
  const emailCookie = '__Host-dvn-session=' + await seal(emailClaims, env.AUTH_COOKIE_SECRET);
  const initiate = (origin, cookie) => startLink({
    request: new Request(site + '/api/auth/start', { method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'linkGoogle' }),
    }), env: connectedEnv,
  });
  assert.equal((await initiate('https://other.test', emailCookie)).status, 403);
  assert.equal((await initiate(site, '')).status, 401);
  const linkStart = await initiate(site, emailCookie);
  assert.equal(linkStart.status, 200);
  const linkAuth = new URL((await linkStart.json()).url);
  expectedChallenge = linkAuth.searchParams.get('code_challenge');
  assert.equal(linkAuth.searchParams.get('prompt'), 'select_account');
  const pendingCookie = linkStart.headers.get('Set-Cookie').split(';')[0];
  const linkUrl = new URL(callbackUrl);
  linkUrl.searchParams.set('state', linkAuth.searchParams.get('state'));
  idToken = await signClaims({ ...claims, nonce: linkAuth.searchParams.get('nonce') });
  const completeLink = (browserSession) => callback({
    request: new Request(linkUrl, { headers: { Cookie: pendingCookie + '; ' + browserSession } }),
    env: connectedEnv,
  });
  const replaced = '__Host-dvn-session=' + await seal({ ...emailClaims, exp: now + 121 }, env.AUTH_COOKIE_SECRET);
  assert.equal((await completeLink(replaced)).headers.get('Location'), site + '/?login=link_failed');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM account_links').get().n, 0);
  const linkedResponse = await completeLink(emailCookie);
  assert.equal(linkedResponse.headers.get('Location'), site + '/?login=linked');
  assert.doesNotMatch(linkedResponse.headers.get('Set-Cookie'), /__Host-dvn-session=/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM account_links').get().n, 1);
  async function linkedSession(cookie) {
    return (await (await session({ request: new Request(site + '/api/auth/session', { headers: { Cookie: cookie } }), env: connectedEnv })).json()).user;
  }
  const fromEmail = await linkedSession(emailCookie);
  const fromGoogle = await linkedSession(sessionCookie.split(';')[0]);
  assert.equal(fromEmail.id, fromGoogle.id);
  assert.deepEqual(fromGoogle.linkedProviders, ['email', 'google']);
  assert.deepEqual(fromEmail.cartAliases, [id]);
});
