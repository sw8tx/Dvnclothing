import { noStore, origin } from '../auth/_lib.js';

const paymentMethods = new Set(['paypal', 'card']);
const maxLines = 30;
const maxQuantity = 99;

export class CheckoutError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function reply(value, status = 200) {
  return noStore(Response.json(value, { status }));
}

export function requestOrigin(request, post = false) {
  const site = origin(request);
  if (!site || new URL(request.url).origin !== site) return reply({ error: 'invalid_host' }, 403);
  if (post && request.headers.get('Origin') !== site) return reply({ error: 'invalid_origin' }, 403);
  return null;
}

// Read the actual stream size: Content-Length can be absent or inaccurate.
// No address, payment details or provider credentials belong in this payload.
export async function readJson(request, { limit = 8192, timeoutMs = 5000 } = {}) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new CheckoutError('invalid_request', 415);
  }
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    throw new CheckoutError('payload_too_large', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new CheckoutError('invalid_request');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let timer;
  const read = async () => {
    let count = 0;
    let text = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > limit) throw new CheckoutError('payload_too_large', 413);
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  };
  try {
    return await Promise.race([
      read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new CheckoutError('request_timeout', 408)), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof CheckoutError) throw error;
    throw new CheckoutError('invalid_request');
  } finally {
    clearTimeout(timer);
    // Cancellation must not prolong the deadline if a client's stream stalls.
    void reader.cancel().catch(() => {});
  }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, names) => record(value) && Object.keys(value).length === names.length
  && Object.keys(value).every(key => names.includes(key));

// This is a cart quote, not an inventory reservation or permission to charge.
// The catalog is imported by the server; client-provided amounts are rejected.
export function normalizeCart(payload, catalog) {
  if (!exactKeys(payload, ['method', 'items']) || !paymentMethods.has(payload.method)) {
    throw new CheckoutError('invalid_request');
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > maxLines) {
    throw new CheckoutError('invalid_cart');
  }
  if (catalog?.currency !== 'EUR' || !Array.isArray(catalog.products)
      || catalog.products.some(product => !record(product) || typeof product.id !== 'string' || !product.id)) {
    throw new CheckoutError('checkout_not_ready', 503);
  }
  const products = new Map(catalog.products.map(product => [product.id, product]));
  if (products.size !== catalog.products.length) throw new CheckoutError('checkout_not_ready', 503);
  const combined = new Map();
  let count = 0;
  let subtotalCents = 0;
  for (const item of payload.items) {
    if (!exactKeys(item, ['productId', 'size', 'quantity']) || typeof item.productId !== 'string'
        || typeof item.size !== 'string' || !Number.isSafeInteger(item.quantity)
        || item.quantity < 1 || item.quantity > maxQuantity) throw new CheckoutError('invalid_cart');
    const product = products.get(item.productId);
    if (!product || !Array.isArray(product.sizes) || !product.sizes.includes(item.size)) {
      throw new CheckoutError('invalid_cart');
    }
    if (!Number.isSafeInteger(product.priceCents) || product.priceCents <= 0
        || product.priceCents > 10000000) throw new CheckoutError('checkout_not_ready', 503);
    count += item.quantity;
    if (count > maxQuantity) throw new CheckoutError('invalid_cart');
    const key = JSON.stringify([product.id, item.size]);
    const previous = combined.get(key);
    if (previous) previous.quantity += item.quantity;
    else combined.set(key, {
      productId: product.id, size: item.size, quantity: item.quantity, unitPriceCents: product.priceCents,
    });
    subtotalCents += product.priceCents * item.quantity;
  }
  return { method: payload.method, currency: catalog.currency, items: [...combined.values()], subtotalCents };
}

// No merchant checkout has been verified for this catalog. In particular the
// welcome-bonus Stripe TEST key cannot activate payments. Keep this fail-closed
// until merchant identity, variants, stock, shipping and tax are configured in
// a real hosted-checkout integration; an environment flag alone is insufficient.
export function checkoutConfig() {
  return { ready: false, methods: [], currency: 'EUR', error: 'checkout_not_ready' };
}
