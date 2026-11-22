import { customer,getOrder,publicOrder,dbFor,owns } from './_commerce.js';
import { reconcile } from './_providers.js';
import { CheckoutError,readJson,reply,requestOrigin } from './_lib.js';
async function handle({request,env},post) {
  const invalid=requestOrigin(request,post);if(invalid)return invalid;
  try {
    const user=await customer(request,env);
    if(!post){
      const result=await dbFor(env).prepare(`SELECT * FROM shop_orders WHERE ${owns} ORDER BY created_at DESC LIMIT 20`).bind(user.id).all();
      return reply({orders:result.results.map(publicOrder)});
    }
    const value=await readJson(request);
    if(!value||Object.keys(value).sort().join(',')!=='action,id'||!['refresh','complete','cancel'].includes(value.action))throw new CheckoutError('invalid_request');
    const order=await getOrder(env,user,value.id);
    try{await reconcile(env,order,{capture:value.action==='complete',cancel:value.action==='cancel'});}
    catch(e){if(!(e instanceof CheckoutError&&e.code==='notification_pending'))throw e;}
    // A delayed staff notification must never make a verified customer payment look failed.
    return reply({order:publicOrder(await getOrder(env,user,value.id))});
  }catch(e){return reply({error:e instanceof CheckoutError?e.code:'order_unavailable'},e instanceof CheckoutError?e.status:503);}
}
export const onRequestGet=c=>handle(c,false);
export const onRequestPost=c=>handle(c,true);
