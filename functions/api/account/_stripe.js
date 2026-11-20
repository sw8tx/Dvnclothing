// Sandbox only. Future checkout must reuse this specific customer to preserve first-order eligibility.
const version = '2026-11-18.endive';
const coupon = 'dvn_welcome15_once_v1';
const base = 'https://api.stripe.com/v1/';

async function stripe(key, path, { data, idempotency, allowMissing } = {}) {
  const headers = { Authorization: 'Bearer ' + key, 'Stripe-Version': version };
  if (idempotency) headers['Idempotency-Key'] = idempotency;
  const response = await fetch(base + path, {
    method: data ? 'POST' : 'GET', headers,
    body: data ? new URLSearchParams(data) : undefined,
    signal: AbortSignal.timeout(7000), redirect: 'error',
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw Error('Stripe sandbox request failed');
  return response.json();
}

function single(list) {
  if (!Array.isArray(list.data) || list.has_more || list.data.length > 1) {
    throw Error('Stripe sandbox record needs reconciliation');
  }
  return list.data[0];
}

function testKey(env) {
  const key = env.STRIPE_TEST_SECRET_KEY;
  if (!/^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(key || '')) throw Error('Stripe sandbox key required');
  return key;
}

export async function retireTestPromotion(env, code) {
  const key = testKey(env);
  const promo = single(await stripe(key, 'promotion_codes?' + new URLSearchParams({ code, limit: '2' })));
  if (!promo) return;
  if (promo.livemode !== false || !/^promo_[A-Za-z0-9]+$/.test(promo.id) || promo.code !== code ||
      promo.promotion?.coupon !== coupon) throw Error('Unexpected sandbox promotion');
  if (promo.active) await stripe(key, 'promotion_codes/' + promo.id, {
    idempotency: 'dvn-welcome-retire-' + promo.id, data: { active: 'false' },
  });
}

export async function prepareTestPromotion(env, code) {
  const key = testKey(env);
  const oldCoupon = await stripe(key, 'coupons/' + coupon, { allowMissing: true });
  const discount = oldCoupon || await stripe(key, 'coupons', {
    idempotency: coupon,
    data: { id: coupon, name: 'DVN Welcome', duration: 'once', percent_off: '15' },
  });
  if (discount.id !== coupon || discount.livemode !== false || discount.duration !== 'once' ||
      discount.percent_off !== 15 || discount.valid !== true) throw Error('Unexpected sandbox coupon');

  // Sandbox customers use a non-deliverable alias. No real email or profile is sent to Stripe.
  const handle = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('stripe-test:' + code));
  const tag = Array.from(new Uint8Array(handle), b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  const alias = tag + '@example.invalid';
  const customer = single(await stripe(key, 'customers?' + new URLSearchParams({ email: alias, limit: '2' }))) ||
    await stripe(key, 'customers', {
      idempotency: 'dvn-welcome-customer-' + tag,
      data: { email: alias, 'metadata[dvn_welcome]': tag },
    });
  if (customer.livemode !== false || customer.metadata?.dvn_welcome !== tag || !customer.id?.startsWith('cus_')) {
    throw Error('Unexpected sandbox customer');
  }
  // Look up inactive/redeemed promotions too. Never replace a previously consumed code.
  const existing = single(await stripe(key, 'promotion_codes?' + new URLSearchParams({ code, limit: '2' })));
  const promo = existing || await stripe(key, 'promotion_codes', {
    idempotency: 'dvn-welcome-promotion-' + tag,
    data: {
      'promotion[type]': 'coupon', 'promotion[coupon]': coupon, customer: customer.id, code,
      'restrictions[first_time_transaction]': 'true', max_redemptions: '1',
    },
  });
  if (promo.livemode !== false || !promo.id?.startsWith('promo_') || promo.code !== code ||
      promo.customer !== customer.id || promo.max_redemptions !== 1 ||
      promo.promotion?.type !== 'coupon' || promo.promotion.coupon !== coupon ||
      promo.restrictions?.first_time_transaction !== true) throw Error('Unexpected sandbox promotion');

  await env.DVN_AUTH_DB.prepare(`UPDATE welcome_bonuses
    SET stripe_test_customer_id = ?, stripe_test_promotion_id = ?
    WHERE code = ? AND stripe_test_promotion_id IS NULL`).bind(customer.id, promo.id, code).run();
  // A link and a previously queued Stripe job may complete in either order.
  const state = await env.DVN_AUTH_DB.prepare('SELECT retired FROM welcome_bonuses WHERE code = ?').bind(code).first();
  if (state?.retired) await retireTestPromotion(env, code);
}
