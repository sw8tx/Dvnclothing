import { rawIdentity } from '../auth/_profile.js';
import { CheckoutError, readJson, reply, requestOrigin } from './_lib.js';
import { customer, payload, ready, reserve } from './_commerce.js';
import { createPayment } from './_providers.js';

export async function onRequestPost({ request, env }) {
  const invalid = requestOrigin(request, true);
  if (invalid) return invalid;
  if (!await rawIdentity(request, env)) return reply({ error: 'unauthenticated' }, 401);
  try {
    const input=await readJson(request);
    payload(input);
    if(!await ready(env))return reply({error:'checkout_not_ready'},503);
    const user=await customer(request,env),order=await reserve(env,user,input);
    if(order.status==='capturing')return reply({error:'payment_pending',orderId:order.id},409);
    return reply({orderId:order.id,url:await createPayment(env,order)});
  } catch (error) {
    if (error instanceof CheckoutError) return reply({ error: error.code }, error.status);
    // Never send parsing, catalog or provider internals back to the browser.
    return reply({ error: 'checkout_not_ready' }, 503);
  }
}
