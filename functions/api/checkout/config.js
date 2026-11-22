import { rawIdentity } from '../auth/_profile.js';
import { checkoutConfig, reply, requestOrigin } from './_lib.js';
import { ready, providerMode } from './_commerce.js';

export async function onRequestGet({ request, env }) {
  const invalid = requestOrigin(request);
  if (invalid) return invalid;
  if (!await rawIdentity(request, env)) return reply({ error: 'unauthenticated' }, 401);
  return reply(await ready(env)?{ready:true,methods:['paypal','card'],currency:'EUR',test:providerMode(env)==='test'}:checkoutConfig());
}
