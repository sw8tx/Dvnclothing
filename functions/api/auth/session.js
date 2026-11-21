import { noStore, ready } from './_lib.js';
import { identity, profileConfigured, readProfile } from './_profile.js';
import { emailReady } from './email/_shared.js';

export async function onRequestGet({ request, env }) {
  const config = {
    configured: ready(env),
    emailConfigured: emailReady(env),
    profileConfigured: profileConfigured(env),
    accountAvailable: true,
  };
  const user = await identity(request, env);
  if (!user) return noStore(Response.json({ ...config, user: null }));
  try {
    return noStore(Response.json({ ...config, user: await readProfile(user, env) }));
  } catch {
    // The raw provider ID may differ from a linked account's canonical ID.
    // Keep sign-in visible but do not use this fallback to read or mutate a bag.
    return noStore(Response.json({ ...config, accountAvailable: false, profileConfigured: false, user: { ...user, linkedProviders: [user.provider], cartAliases: [] } }));
  }
}
