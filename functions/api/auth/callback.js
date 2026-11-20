import { identityFromClaims, rawIdentity } from './_profile.js';
import { linkAccounts } from './_links.js';
import { mac } from './email/_shared.js';
import { clearCookie, cookie, noStore, origin, ready, seal, setCookie, unseal, verifyGoogleToken } from './_lib.js';

export async function onRequestGet({ request, env }) {
  const site = origin(request);
  if (!site || !ready(env)) return noStore(new Response('Login unavailable', { status: 503 }));
  if (new URL(request.url).origin !== site) return noStore(new Response('Invalid host', { status: 400 }));
  const url = new URL(request.url);
  const pending = await unseal(cookie(request, '__Host-dvn-pending'), env.AUTH_COOKIE_SECRET);
  function finish(status) {
    const response = noStore(Response.redirect(site + '/?login=' + status, 302));
    clearCookie(response, '__Host-dvn-pending');
    return response;
  }
  const failed = pending?.linking ? 'link_failed' : 'failed';
  if (!pending || !url.searchParams.get('state') || pending.state !== url.searchParams.get('state') || !url.searchParams.get('code')) {
    return finish(failed);
  }
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${site}/api/auth/callback`, grant_type: 'authorization_code' }),
    });
    if (!tokenResponse.ok) throw Error('Token exchange failed');
    const { id_token: idToken } = await tokenResponse.json();
    const profile = await verifyGoogleToken(idToken, env.GOOGLE_CLIENT_ID, pending.nonce);
    if (pending.linking) {
      const emailUser = await rawIdentity(request, env);
      const sessionKey = await mac(env.AUTH_COOKIE_SECRET, 'link-session', cookie(request, '__Host-dvn-session'));
      if (emailUser?.provider !== 'email' || pending.linking.emailId !== emailUser.id ||
          pending.linking.sessionKey !== sessionKey) return finish('link_failed');
      const googleUser = await identityFromClaims(profile);
      const linked = await linkAccounts(env, emailUser, googleUser);
      return finish(linked ? 'linked' : 'link_conflict');
    }
    const session = await seal({ ...profile, exp: Math.floor(Date.now() / 1000) + 604800 }, env.AUTH_COOKIE_SECRET);
    const response = noStore(Response.redirect(`${site}/?login=complete`, 302));
    clearCookie(response, '__Host-dvn-pending');
    setCookie(response, '__Host-dvn-session', session, 604800);
    return response;
  } catch {
    return finish(failed);
  }
}
