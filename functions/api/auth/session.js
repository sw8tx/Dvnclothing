import { cookie, noStore, ready, unseal } from './_lib.js';

export async function onRequestGet({ request, env }) {
  const configured = ready(env);
  const session = configured ? await unseal(cookie(request, '__Host-dvn-session'), env.AUTH_COOKIE_SECRET) : null;
  return noStore(Response.json({ configured, user: session ? { name: session.name, email: session.email, picture: session.picture } : null }));
}
