import { noStore, origin } from './auth/_lib.js';

const methods = new Map([
  ['/api/preview/unlock', ['POST']],
  ['/api/preview/logout', ['POST']],
  ['/api/checkout/config', ['GET']],
  ['/api/checkout/inventory', ['GET']],
  ['/api/checkout/session', ['POST']],
  ['/api/checkout/quote', ['POST']],
  ['/api/checkout/order', ['GET', 'POST']],
  ['/api/account/cart', ['GET', 'POST']],
  ['/api/payments/return', ['GET']],
  ['/api/payments/stripe', ['POST']],
  ['/api/payments/paypal', ['POST']],
  ['/api/auth/start', ['GET', 'POST']],
  ['/api/auth/callback', ['GET']],
  ['/api/auth/session', ['GET']],
  ['/api/auth/logout', ['POST']],
  ['/api/auth/profile', ['POST']],
  ['/api/auth/email/start', ['POST']],
  ['/api/auth/email/verify', ['POST']],
  ['/api/account/bonus', ['GET', 'POST']],
  ['/api/account/bonus-email', ['POST']],
]);

const fail = (error, status, headers = {}) => noStore(Response.json({ error }, { status, headers }));

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const allowed = methods.get(url.pathname);
  // Unknown API paths and unsupported methods must never fall through to the
  // static storefront with a misleading HTML 200 response.
  if (!allowed) return fail('not_found', 404);
  if (!allowed.includes(request.method)) return fail('method_not_allowed', 405, { Allow: allowed.join(', ') });
  const site = origin(request);
  const canonicalRedirect = url.pathname === '/api/auth/start' && request.method === 'GET';
  if (!site || (url.origin !== site && !canonicalRedirect)) return fail('invalid_host', 403);
  const signedWebhook=['/api/payments/stripe','/api/payments/paypal'].includes(url.pathname);
  if (request.method === 'POST' && !signedWebhook && request.headers.get('Origin') !== site) return fail('invalid_origin', 403);
  try {
    return noStore(await context.next());
  } catch {
    // Never return or log exception messages: providers can include SQL, email
    // addresses, authorization codes or secrets in them.
    console.warn('account_api', { route: url.pathname, category: 'unexpected' });
    return fail('temporarily_unavailable', 503, { 'Retry-After': '60' });
  }
}
