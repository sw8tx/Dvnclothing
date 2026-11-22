import { readJson,reply,CheckoutError } from '../checkout/_lib.js';
import { dbFor,providerMode } from '../checkout/_commerce.js';
import { paypal,reconcile } from '../checkout/_providers.js';
export async function onRequestPost({request,env}) {
  try {
    if(!env.PAYPAL_WEBHOOK_ID)return reply({error:'webhook_unavailable'},503);
    const event=await readJson(request,{limit:65536});
    const fields={'auth_algo':'paypal-auth-algo','cert_url':'paypal-cert-url','transmission_id':'paypal-transmission-id',
      'transmission_sig':'paypal-transmission-sig','transmission_time':'paypal-transmission-time'};
    const signature={webhook_id:env.PAYPAL_WEBHOOK_ID,webhook_event:event};
    for(const [key,header] of Object.entries(fields)){
      const value=request.headers.get(header);if(!value||value.length>4096)return reply({error:'invalid_signature'},400);
      signature[key]=value;
    }
    const verified=await paypal(env,providerMode(env),'/v1/notifications/verify-webhook-signature',signature);
    if(verified.verification_status!=='SUCCESS')return reply({error:'invalid_signature'},400);
    if(!['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED'].includes(event.event_type))return reply({received:true});
    const id=event.event_type==='CHECKOUT.ORDER.APPROVED'?event.resource?.id:event.resource?.supplementary_data?.related_ids?.order_id;
    if(typeof id!=='string')return reply({error:'invalid_event'},400);
    const order=await dbFor(env).prepare("SELECT * FROM shop_orders WHERE provider_id=? AND method='paypal'").bind(id).first();
    if(order)await reconcile(env,order,{capture:event.event_type==='CHECKOUT.ORDER.APPROVED'});
    return reply({received:true});
  }catch(e){return reply({error:e instanceof CheckoutError?e.code:'webhook_unavailable'},e instanceof CheckoutError?e.status:503);}
}
