import { readJson,reply,CheckoutError } from '../checkout/_lib.js';
import { dbFor } from '../checkout/_commerce.js';
import { reconcile } from '../checkout/_providers.js';
export async function verifyStripeSignature(raw,header,secret,now=Date.now()) {
  if(!secret?.startsWith('whsec_')||!header||header.length>4096)return false;
  const parts=header.split(',').map(x=>x.split('=')),timestamp=parts.find(([k])=>k==='t')?.[1];
  if(!/^\d+$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=new TextEncoder().encode(timestamp+'.'+raw);
  for(const [kind,value] of parts){
    if(kind==='v1'&&/^[a-f0-9]{64}$/.test(value)&&await crypto.subtle.verify('HMAC',key,
      Uint8Array.from(value.match(/../g),x=>parseInt(x,16)),bytes))return true;
  }
  return false;
}
export async function onRequestPost({request,env}) {
  try {
    const raw=await readJson(request,{limit:65536,raw:true});
    if(!await verifyStripeSignature(raw,request.headers.get('Stripe-Signature'),env.STRIPE_CHECKOUT_WEBHOOK_SECRET))return reply({error:'invalid_signature'},400);
    const event=JSON.parse(raw);
    if(!['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded'].includes(event.type))return reply({received:true});
    const session=event.data?.object;
    const order=await dbFor(env).prepare('SELECT * FROM shop_orders WHERE id=? AND method=\'card\'').bind(session?.metadata?.dvn_order_id||'').first();
    if(!order)return reply({received:true});
    if(!order.provider_id)return reply({error:'payment_pending'},503);
    if(session.id!==order.provider_id||event.livemode!==(order.mode==='live'))return reply({error:'payment_mismatch'},400);
    // Fetch authoritative state. Replayed and out-of-order events cannot double-debit stock.
    await reconcile(env,order);
    return reply({received:true});
  }catch(e){return reply({error:e instanceof CheckoutError?e.code:'webhook_unavailable'},e instanceof CheckoutError?e.status:503);}
}
