import { cookie, noStore, origin, random, ready, seal, setCookie } from './_lib.js';
import { profileConfigured, rawIdentity } from './_profile.js';
import { body, mac } from './email/_shared.js';

async function begin(env, site, linking) {
  const state = random();
  const nonce = random();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: site + '/api/auth/callback',
    response_type: 'code', scope: 'openid email profile', state, nonce,
  }).toString();
  if (linking) url.searchParams.set('prompt', 'select_account');
  const response = noStore(linking ? Response.json({ url: url.href }) : Response.redirect(url, 302));
  const pending = await seal({ state, nonce, linking, exp: Math.floor(Date.now() / 1000) + 600 }, env.AUTH_COOKIE_SECRET);
  setCookie(response, '__Host-dvn-pending', pending, 600);
  return response;
}

export async function onRequestGet({ request, env }) {
  const site = origin(request);
  if (!site) return noStore(new Response('Unsupported host', { status: 400 }));
  if (new URL(request.url).origin !== site) return noStore(Response.redirect(site + '/api/auth/start', 302));
  if (!ready(env)) return noStore(new Response('Google login is being configured', { status: 503 }));
  return begin(env, site, null);
}

export async function onRequestPost({ request, env }) {
  const site = origin(request);
  const fail = (error, status) => noStore(Response.json({ error }, { status }));
  if (!site || new URL(request.url).origin !== site || request.headers.get('Origin') !== site) return fail('invalid_origin', 403);
  if (!ready(env) || !profileConfigured(env)) return fail('link_unavailable', 503);
  const user = await rawIdentity(request, env);
  if (user?.provider !== 'email') return fail('unauthenticated', 401);
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return fail('invalid_request', 415);
  if ((await body(request))?.action !== 'linkGoogle') return fail('invalid_request', 400);
  const sessionKey = await mac(env.AUTH_COOKIE_SECRET, 'link-session', cookie(request, '__Host-dvn-session'));
  return begin(env, site, { emailId: user.id, sessionKey });
}
