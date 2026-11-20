const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

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
  const pending = response.headers.get('Set-Cookie');
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
  const token = await seal({ exp: Math.floor(Date.now() / 1000) + 120, name: 'Taylor', email: 'taylor@example.com' }, env.AUTH_COOKIE_SECRET);
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
});

test('a verified Google callback exchanges the code and creates a usable session', async (t) => {
  const { onRequestGet: start } = await import('../functions/api/auth/start.js');
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
  const profile = { name: 'Alex', email: 'alex@example.test', picture: '' };
  const claims = {
    ...profile, iss: 'https://accounts.google.com', sub: 'test-subject', aud: env.GOOGLE_CLIENT_ID,
    nonce: authorization.get('nonce'), iat: now, exp: now + 300, email_verified: true,
  };
  const payload = [header, claims].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKeys.privateKey, Buffer.from(payload));
  const idToken = payload + '.' + Buffer.from(signature).toString('base64url');
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('code'), 'test-authorization-code');
      assert.equal(options.body.get('redirect_uri'), authorization.get('redirect_uri'));
      assert.equal(options.body.get('client_id'), env.GOOGLE_CLIENT_ID);
      assert.equal(options.body.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
      assert.equal(options.body.get('grant_type'), 'authorization_code');
      return Response.json({ id_token: idToken });
    }
    assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
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
  assert.deepEqual(await currentSession.json(), { configured: true, user: profile });
});
