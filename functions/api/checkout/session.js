import { privatePages } from '../../_private-pages.js';
import { rawIdentity } from '../auth/_profile.js';
import { CheckoutError, normalizeCart, readJson, reply, requestOrigin } from './_lib.js';

// Reuse the validated build output without JSON import attributes, which the
// Cloudflare Pages build system's Wrangler version does not support.
const catalog = JSON.parse(privatePages['/catalog.json'].body);

export async function onRequestPost({ request, env }) {
  const invalid = requestOrigin(request, true);
  if (invalid) return invalid;
  if (!await rawIdentity(request, env)) return reply({ error: 'unauthenticated' }, 401);
  try {
    normalizeCart(await readJson(request), catalog);
  } catch (error) {
    if (error instanceof CheckoutError) return reply({ error: error.code }, error.status);
    // Never send parsing, catalog or provider internals back to the browser.
    return reply({ error: 'checkout_not_ready' }, 503);
  }
  // A valid selection is not a confirmed order. Merchant checkout, inventory
  // verification and order fulfilment are not configured for these products yet.
  return reply({ error: 'checkout_not_ready' }, 503);
}
