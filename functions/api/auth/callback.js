import { clearCookie, cookie, noStore, origin, ready, seal, setCookie, unseal, verifyGoogleToken } from './_lib.js';

export async function onRequestGet({ request, env }) {
  const site = origin(request);
  if (!site || !ready(env)) return noStore(new Response('Login unavailable', { status: 503 }));
  if (new URL(request.url).origin !== site) return noStore(new Response('Invalid host', { status: 400 }));
  const url = new URL(request.url);
  const pending = await unseal(cookie(request, '__Host-dvn-pending'), env.AUTH_COOKIE_SECRET);
  if (!pending || !url.searchParams.get('state') || pending.state !== url.searchParams.get('state') || !url.searchParams.get('code')) {
    const response = noStore(Response.redirect(`${site}/?login=failed`, 302));
    clearCookie(response, '__Host-dvn-pending');
    return response;
  }
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${site}/api/auth/callback`, grant_type: 'authorization_code' }),
    });
    if (!tokenResponse.ok) throw Error('Token exchange failed');
    const { id_token: idToken } = await tokenResponse.json();
    const profile = await verifyGoogleToken(idToken, env.GOOGLE_CLIENT_ID, pending.nonce);
    const session = await seal({ ...profile, exp: Math.floor(Date.now() / 1000) + 604800 }, env.AUTH_COOKIE_SECRET);
    const response = noStore(Response.redirect(`${site}/?login=complete`, 302));
    clearCookie(response, '__Host-dvn-pending');
    setCookie(response, '__Host-dvn-session', session, 604800);
    return response;
  } catch {
    const response = noStore(Response.redirect(`${site}/?login=failed`, 302));
    clearCookie(response, '__Host-dvn-pending');
    return response;
  }
}
