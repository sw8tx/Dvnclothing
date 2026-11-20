import { noStore, ready } from './_lib.js';
import { identity, profileConfigured, readProfile } from './_profile.js';
import { emailReady } from './email/_shared.js';

export async function onRequestGet({ request, env }) {
  const config = {
    configured: ready(env),
    emailConfigured: emailReady(env),
    profileConfigured: profileConfigured(env),
  };
  const user = await identity(request, env);
  if (!user) return noStore(Response.json({ ...config, user: null }));
  try {
    return noStore(Response.json({ ...config, user: await readProfile(user, env) }));
  } catch {
    return noStore(Response.json({ ...config, profileConfigured: false, user }));
  }
}
