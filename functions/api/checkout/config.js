import { rawIdentity } from '../auth/_profile.js';
import { checkoutConfig, reply, requestOrigin } from './_lib.js';

export async function onRequestGet({ request, env }) {
  const invalid = requestOrigin(request);
  if (invalid) return invalid;
  if (!await rawIdentity(request, env)) return reply({ error: 'unauthenticated' }, 401);
  return reply(checkoutConfig());
}
