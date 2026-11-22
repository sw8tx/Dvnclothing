import { privatePages } from '../../_private-pages.js';
import { rawIdentity, readProfile } from '../auth/_profile.js';
import { CheckoutError, normalizeCart } from './_lib.js';

export const catalog = JSON.parse(privatePages['/catalog.json'].body);
export const dbFor = env => env.DVN_AUTH_DB;
export const owns = `owner_id IN (?1, (SELECT google_id FROM account_links WHERE email_id=?1),
  (SELECT email_id FROM account_links WHERE google_id=?1))`;
export const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest(
  'SHA-256',new TextEncoder().encode(value))), b=>b.toString(16).padStart(2,'0')).join('');

export async function customer(request, env) {
  const raw = await rawIdentity(request, env);
  if (!raw) throw new CheckoutError('unauthenticated',401);
  if (!dbFor(env)?.prepare) throw new CheckoutError('temporarily_unavailable',503);
  return readProfile(raw, env);
}
export function providerMode(env) { return env.COMMERCE_MODE === 'live' ? 'live' : 'test'; }
export function configured(env={}, now=Date.now()) {
  const mode=providerMode(env);
  // Explicit release gate, distinct sandbox credentials and verified legal setup.
  if (env.COMMERCE_ENABLED!=='true' || !['live','test'].includes(env.COMMERCE_MODE)
    || !env.DVN_AUTH_DB?.prepare || !catalog.shipping.confirmed
    || catalog.products.some(p=>!p.inventoryVerified)) return false;
  if(mode==='live' && (now<Date.parse(catalog.launchAt) || env.COMMERCE_LEGAL_READY!=='true')) return false;
  const stripe=mode==='live'?env.STRIPE_LIVE_SECRET_KEY:env.STRIPE_CHECKOUT_TEST_SECRET_KEY;
  return Boolean(stripe?.startsWith(mode==='live'?'sk_live_':'sk_test_')
    && env.STRIPE_CHECKOUT_WEBHOOK_SECRET?.startsWith('whsec_')
    && env.PAYPAL_CHECKOUT_CLIENT_ID && env.PAYPAL_CHECKOUT_CLIENT_SECRET && env.PAYPAL_MERCHANT_ID && env.PAYPAL_WEBHOOK_ID);
}
export async function ready(env) {
  if(!configured(env)) return false;
  try {
    const result=await dbFor(env).prepare('SELECT product_id,size,available FROM shop_inventory').bind().all();
    return catalog.products.every(p=>p.sizes.every(size=>result.results.some(r=>r.product_id===p.id&&r.size===size)))
      && Boolean(env.DISCORD_ORDER_WEBHOOK_URL)
      && Boolean(await dbFor(env).prepare('SELECT id FROM shop_notifications LIMIT 1').bind().all());
  } catch { return false; }
}
export function payload(value) {
  if(!value || typeof value!=='object' || Array.isArray(value)
    || Object.keys(value).some(k=>!['method','items','code'].includes(k))
    || (value.code!==undefined && (typeof value.code!=='string'||value.code.length>50))) {
    throw new CheckoutError('invalid_request');
  }
  return {...normalizeCart({method:value.method,items:value.items},catalog),code:(value.code||'').trim().toUpperCase()};
}
export async function quote(env,user,input) {
  const cart=payload(input), db=dbFor(env), key=await digest('dvn-welcome-v1:'+user.email.trim().toLowerCase());
  const stock=await db.prepare('SELECT product_id,size,available FROM shop_inventory').bind().all();
  if(cart.items.some(l=>!stock.results.some(r=>r.product_id===l.productId&&r.size===l.size&&r.available>=l.quantity))) {
    throw new CheckoutError('stock_unavailable',409);
  }
  let discountCents=0;
  if(cart.code){
    const bonus=await db.prepare(`SELECT code FROM welcome_bonuses WHERE ${owns} AND retired=0 AND code=?2 COLLATE NOCASE`).bind(user.id,cart.code).first();
    const used=await db.prepare(`SELECT id FROM shop_orders WHERE mode=?2 AND status='paid' AND (customer_key=?3 OR ${owns}) LIMIT 1`).bind(user.id,providerMode(env),key).first();
    if(!bonus||used)throw new CheckoutError('discount_unavailable',409);
    discountCents=Math.round(cart.subtotalCents*15/100);
  }
  return {...cart,customerKey:key,discountCents,shippingCents:catalog.shipping.priceCents,
    totalCents:cart.subtotalCents-discountCents+catalog.shipping.priceCents};
}
export async function getOrder(env,user,id) {
  if(typeof id!=='string'||!/^dvn_[a-f0-9]{32}$/.test(id))throw new CheckoutError('invalid_order');
  const row=await dbFor(env).prepare(`SELECT * FROM shop_orders WHERE ${owns} AND id=?2`).bind(user.id,id).first();
  if(!row)throw new CheckoutError('not_found',404);
  return row;
}
export function publicOrder(o) {
  return {id:o.id,status:o.status,method:o.method,currency:o.currency,subtotalCents:o.subtotal_cents,
    discountCents:o.discount_cents,shippingCents:o.shipping_cents,totalCents:o.total_cents,
    items:JSON.parse(o.items_json),createdAt:o.created_at,test:o.mode==='test',
    approvalUrl:o.status==='pending'?o.approval_url:null};
}
export async function reserve(env,user,input) {
  const cart=payload(input), key=await digest('dvn-welcome-v1:'+user.email.trim().toLowerCase());
  cart.items.sort((a,b)=>(a.productId+':'+a.size).localeCompare(b.productId+':'+b.size));
  const hash=await digest(JSON.stringify(cart));
  const db=dbFor(env), mode=providerMode(env);
  const existing=()=>db.prepare(`SELECT * FROM shop_orders WHERE (customer_key=?3 OR ${owns}) AND mode=?2 AND status IN ('creating','pending','capturing')`).bind(user.id,mode,key).first();
  // PayPal is captured exclusively by this server. Expired pending approvals
  // cannot win the capture transition and may safely release their stock.
  await db.prepare(`UPDATE shop_orders SET status='cancelled',updated_at=unixepoch()
    WHERE method='paypal' AND status='pending' AND created_at<unixepoch()-3600`).bind().run();
  const resume=async row=>{
    await getOrder(env,user,row.id); // An email hash is never authorization.
    if(row.request_hash!==hash)throw new CheckoutError('pending_order',409);
    return row;
  };
  const prior=await existing();if(prior)return resume(prior);
  const id='dvn_'+crypto.randomUUID().replaceAll('-','');
  try {
    const q=await quote(env,user,input);
    await db.prepare(`INSERT INTO shop_orders(id,owner_id,customer_key,email,method,mode,request_hash,items_json,
      subtotal_cents,discount_cents,discount_code,shipping_cents,total_cents)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,user.id,key,user.email,cart.method,mode,hash,
      JSON.stringify(q.items),q.subtotalCents,q.discountCents,q.code||null,q.shippingCents,q.totalCents).run();
  } catch(error) {
    const concurrent=await existing();if(concurrent)return resume(concurrent);
    if(String(error.message).includes('stock_unavailable'))throw new CheckoutError('stock_unavailable',409);
    if(/discount_unavailable|shop_orders.discount_code/.test(String(error.message)))throw new CheckoutError('discount_unavailable',409);
    throw error;
  }
  return getOrder(env,user,id);
}
