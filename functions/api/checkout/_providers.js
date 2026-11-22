import { storedDelivery,providerShipping } from './_details.js';
import { CheckoutError } from './_lib.js';
import { dbFor, catalog } from './_commerce.js';
import { validShipping,retainedShipping,notifyPaid } from './_notifications.js';

const site='https://dvnclothing.com';
const euros=cents=>(cents/100).toFixed(2);
const providerError=()=>new CheckoutError('payment_unavailable',503);
async function jsonFetch(url,options) {
  let response;
  try {response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{throw providerError();}
  if(!response.ok)throw providerError();
  return response.json();
}
export function stripe(env,mode,path,params,key) {
  const secret=mode==='live'?env.STRIPE_LIVE_SECRET_KEY:env.STRIPE_CHECKOUT_TEST_SECRET_KEY;
  if(!secret?.startsWith(mode==='live'?'sk_live_':'sk_test_'))throw providerError();
  return jsonFetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',
    headers:{Authorization:'Bearer '+secret,'Stripe-Version':'2025-06-30.basil',
      ...(params?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key}: {})},
    body:params?new URLSearchParams(params):undefined});
}
export async function paypal(env,mode,path,body,key) {
  // Never use a client-controlled API host or return address.
  const base=mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  const auth=await jsonFetch(base+'/v1/oauth2/token',{method:'POST',headers:{
    Authorization:'Basic '+btoa(env.PAYPAL_CHECKOUT_CLIENT_ID+':'+env.PAYPAL_CHECKOUT_CLIENT_SECRET),
    'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  if(typeof auth.access_token!=='string')throw providerError();
  return jsonFetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth.access_token,
    'Content-Type':'application/json',...(key?{'PayPal-Request-Id':key}: {})},body:body?JSON.stringify(body):undefined});
}
export function approvedURL(value,method,mode) {
  try {
    const url=new URL(value),host=method==='card'?'checkout.stripe.com':mode==='live'?'www.paypal.com':'www.sandbox.paypal.com';
    if(url.protocol==='https:'&&url.hostname===host&&!url.username&&!url.password&&!url.port)return url.href;
  } catch {}
  throw providerError();
}
export async function createPayment(env,order) {
  if(order.approval_url)return approvedURL(order.approval_url,order.method,order.mode);
  // Provider idempotency retention is finite. Ambiguous old attempts require reconciliation.
  if(Date.now()/1000-order.created_at>5*3600)throw new CheckoutError('payment_review_required',409);
  const items=JSON.parse(order.items_json),back=site+'/api/payments/return?order='+order.id;
  const delivery=storedDelivery(order);
  let result,url;
  if(order.method==='card'){
    const params={mode:'payment',customer_email:order.email,client_reference_id:order.id,
      'metadata[dvn_order_id]':order.id,'payment_intent_data[metadata][dvn_order_id]':order.id,
      success_url:back,cancel_url:back+'&cancel=1','payment_method_types[0]':'card',
      'shipping_address_collection[allowed_countries][0]':'DE',expires_at:String(order.created_at+3600),
      'shipping_options[0][shipping_rate_data][type]':'fixed_amount',
      'shipping_options[0][shipping_rate_data][fixed_amount][amount]':String(order.shipping_cents),
      'shipping_options[0][shipping_rate_data][fixed_amount][currency]':'eur',
      'shipping_options[0][shipping_rate_data][display_name]':'Standardversand Deutschland · 3–5 Werktage'};
    if(delivery){
      const shipping=providerShipping(delivery,'card');
      const customerParams={email:order.email,name:shipping.name,'shipping[name]':shipping.name,'metadata[dvn_order_id]':order.id};
      for(const [key,value] of Object.entries(shipping.address))customerParams['shipping[address]['+key+']']=value;
      if(delivery.phone)customerParams.phone=delivery.phone;
      const customer=await stripe(env,order.mode,'customers',customerParams,order.id+'-customer');
      if(typeof customer.id!=='string'||!/^cus_[A-Za-z0-9]+$/.test(customer.id))throw providerError();
      delete params.customer_email;params.customer=customer.id;params['customer_update[shipping]']='auto';
    }
    // Distribute the integer-cent discount deterministically across units.
    // No client totals or reusable provider-wide coupons are accepted.
    let remaining=order.discount_cents,index=0,remainingSubtotal=order.subtotal_cents;
    for(const line of items)for(let n=0;n<line.quantity;n++){
      const discount=Math.min(line.unitPriceCents,Math.round(remaining*line.unitPriceCents/remainingSubtotal));
      remaining-=discount;remainingSubtotal-=line.unitPriceCents;
      const name=catalog.products.find(p=>p.id===line.productId).name+' · '+line.size+(order.discount_cents?' · inkl. 15 % Willkommensrabatt':'');
      Object.assign(params,{[`line_items[${index}][price_data][currency]`]:'eur',
        [`line_items[${index}][price_data][unit_amount]`]:String(line.unitPriceCents-discount),
        [`line_items[${index}][price_data][product_data][name]`]:name,[`line_items[${index}][quantity]`]:'1'});index++;
    }
    result=await stripe(env,order.mode,'checkout/sessions',params,order.id+'-create');url=result.url;
  }else{
    result=await paypal(env,order.mode,'/v2/checkout/orders',{
      intent:'CAPTURE',purchase_units:[{reference_id:order.id,custom_id:order.id,invoice_id:order.id,
        ...(delivery?{shipping:providerShipping(delivery,'paypal')}:{}),
        payee:{merchant_id:env.PAYPAL_MERCHANT_ID},amount:{currency_code:'EUR',value:euros(order.total_cents),breakdown:{
          item_total:{currency_code:'EUR',value:euros(order.subtotal_cents)},
          shipping:{currency_code:'EUR',value:euros(order.shipping_cents)},discount:{currency_code:'EUR',value:euros(order.discount_cents)}}},
        items:items.map(l=>({name:catalog.products.find(p=>p.id===l.productId).name+' · '+l.size,
          sku:l.productId+':'+l.size,quantity:String(l.quantity),unit_amount:{currency_code:'EUR',value:euros(l.unitPriceCents)}}))}],
      payment_source:{paypal:{experience_context:{brand_name:'DVN CLOTHING',user_action:'PAY_NOW',
        shipping_preference:delivery?'SET_PROVIDED_ADDRESS':'GET_FROM_FILE',return_url:back,cancel_url:back+'&cancel=1'}}}
    },order.id+'-create');url=result.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href;
  }
  url=approvedURL(url,order.method,order.mode);
  if(typeof result.id!=='string'||!result.id)throw providerError();
  await dbFor(env).prepare(`UPDATE shop_orders SET provider_id=?,approval_url=?,status='pending',updated_at=unixepoch()
    WHERE id=? AND status='creating'`).bind(result.id,url,order.id).run();
  return url;
}
export function validateStripe(order,session) {
  const address=session.collected_information?.shipping_details||session.shipping_details;
  if(session.id!==order.provider_id||session.client_reference_id!==order.id||session.metadata?.dvn_order_id!==order.id
    ||session.livemode!==(order.mode==='live')||session.currency!=='eur'||session.amount_total!==order.total_cents
    ||session.payment_status!=='paid'||session.status!=='complete'||!validShipping(address,'card')
    ||typeof session.payment_intent!=='string')throw new CheckoutError('payment_verification_failed',409);
  return {paymentId:session.payment_intent,shipping:retainedShipping(address,'card')};
}
export function validatePayPal(order,result,merchant) {
  const unit=result.purchase_units?.[0],capture=unit?.payments?.captures?.[0];
  if(result.id!==order.provider_id||result.status!=='COMPLETED'||result.purchase_units?.length!==1
    ||unit.custom_id!==order.id||unit.payee?.merchant_id!==merchant||!validShipping(unit.shipping,'paypal')
    ||unit.payments?.captures?.length!==1||capture?.status!=='COMPLETED'||capture?.amount?.currency_code!=='EUR'
    ||capture?.amount?.value!==euros(order.total_cents)||!capture?.id)throw new CheckoutError('payment_verification_failed',409);
  return {paymentId:capture.id,shipping:retainedShipping(unit.shipping,'paypal')};
}
async function paid(env,order,proof) {
  await dbFor(env).prepare(`UPDATE shop_orders SET status='paid',payment_id=?,fulfilment_json=?,
    paid_at=unixepoch(),updated_at=unixepoch() WHERE id=? AND status IN ('pending','capturing')`)
    .bind(proof.paymentId,JSON.stringify(proof.shipping),order.id).run();
  await notifyPaid(env,order.id);
}
export async function reconcile(env,order,{capture=false,cancel=false}={}) {
  if(order.status==='paid'){await notifyPaid(env,order.id);return;}
  if(order.status==='cancelled')return;
  if(!order.provider_id)throw new CheckoutError('payment_review_required',409);
  if(order.method==='card'){
    let session=await stripe(env,order.mode,'checkout/sessions/'+encodeURIComponent(order.provider_id));
    if(cancel&&session.status==='open')session=await stripe(env,order.mode,'checkout/sessions/'+encodeURIComponent(order.provider_id)+'/expire',{},order.id+'-expire');
    if(session.status==='complete')await paid(env,order,validateStripe(order,session));
    else if(session.status==='expired')await dbFor(env).prepare(`UPDATE shop_orders SET status='cancelled',updated_at=unixepoch() WHERE id=? AND status='pending'`).bind(order.id).run();
  }else{
    let result=await paypal(env,order.mode,'/v2/checkout/orders/'+encodeURIComponent(order.provider_id));
    if(result.status==='COMPLETED'){await paid(env,order,validatePayPal(order,result,env.PAYPAL_MERCHANT_ID));return;}
    if(cancel){
      // Capture requires winning this same state transition. Never free stock during an ambiguous capture.
      await dbFor(env).prepare(`UPDATE shop_orders SET status='cancelled',updated_at=unixepoch() WHERE id=? AND status='pending'`).bind(order.id).run();return;
    }
    if(capture&&result.status==='APPROVED'){
      if(Date.now()/1000-order.created_at>3600){
        await dbFor(env).prepare(`UPDATE shop_orders SET status='cancelled',updated_at=unixepoch() WHERE id=? AND status='pending'`).bind(order.id).run();return;
      }
      const unit=result.purchase_units?.[0];
      if(result.id!==order.provider_id||result.purchase_units?.length!==1||unit?.custom_id!==order.id||unit?.amount?.currency_code!=='EUR'||unit?.amount?.value!==euros(order.total_cents)
        ||unit?.payee?.merchant_id!==env.PAYPAL_MERCHANT_ID||!validShipping(unit?.shipping,'paypal'))throw new CheckoutError('shipping_or_payment_invalid',409);
      const lock=await dbFor(env).prepare(`UPDATE shop_orders SET status='capturing',updated_at=unixepoch() WHERE id=? AND status='pending' AND created_at>=unixepoch()-3600 RETURNING id`).bind(order.id).first();
      // One capture request only. A timeout is reconciled with GET; never retried as a new charge.
      if(lock){
        await paypal(env,order.mode,'/v2/checkout/orders/'+encodeURIComponent(order.provider_id)+'/capture',{},order.id+'-capture');
        result=await paypal(env,order.mode,'/v2/checkout/orders/'+encodeURIComponent(order.provider_id));
        if(result.status==='COMPLETED')await paid(env,order,validatePayPal(order,result,env.PAYPAL_MERCHANT_ID));
      }
    }
  }
}
