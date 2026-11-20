import { noStore, origin, random, ready, seal, setCookie } from './_lib.js';

export async function onRequestGet({ request, env }) {
  const site = origin(request);
  if (!site) return noStore(new Response('Unsupported host', { status: 400 }));
  if (new URL(request.url).origin !== site) return noStore(Response.redirect(`${site}/api/auth/start`, 302));
  if (!ready(env)) return noStore(new Response('Google login is being configured', { status: 503 }));
  const state = random();
  const nonce = random();
  const redirectUri = `${site}/api/auth/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce }).toString();
  const response = noStore(Response.redirect(url, 302));
  const pending = await seal({ state, nonce, exp: Math.floor(Date.now() / 1000) + 600 }, env.AUTH_COOKIE_SECRET);
  setCookie(response, '__Host-dvn-pending', pending, 600);
  return response;
}
