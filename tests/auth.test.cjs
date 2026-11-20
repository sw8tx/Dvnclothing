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
