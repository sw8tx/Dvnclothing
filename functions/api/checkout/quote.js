import { customer, quote } from './_commerce.js';
import { CheckoutError, readJson, reply, requestOrigin } from './_lib.js';
export async function onRequestPost({request,env}) {
  const invalid=requestOrigin(request,true);if(invalid)return invalid;
  try {
    const user=await customer(request,env),q=await quote(env,user,await readJson(request));
    return reply({currency:q.currency,subtotalCents:q.subtotalCents,discountCents:q.discountCents,
      shippingCents:q.shippingCents,totalCents:q.totalCents,code:q.code,inventoryChecked:true});
  } catch(e){return reply({error:e instanceof CheckoutError?e.code:'quote_unavailable'},e instanceof CheckoutError?e.status:503);}
}
