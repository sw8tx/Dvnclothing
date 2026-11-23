import { grantAdmin } from './_access.js';
import { readJson,reply,CheckoutError,requestOrigin } from '../checkout/_lib.js';
export async function onRequestPost({request,env}){
  const invalid=requestOrigin(request,true);if(invalid)return invalid;
  try{
    const body=await readJson(request,{limit:512});
    if(!body||Object.keys(body).join(',')!=='password')throw new CheckoutError('invalid_request');
    return await grantAdmin(request,env,body.password);
  }catch(error){return reply({error:error instanceof CheckoutError?error.code:'temporarily_unavailable'},error instanceof CheckoutError?error.status:503);}
}
