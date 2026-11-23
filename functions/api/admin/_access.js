import { cookie,seal,setCookie,unseal } from '../auth/_lib.js';
import { rawIdentity } from '../auth/_profile.js';
import { CheckoutError } from '../checkout/_lib.js';

const name='__Host-dvn-admin',attempts='__Host-dvn-admin-attempts';
const defaultHash='4f0c33a7e32c330a988607ae480aec225aa499649d478d1c1ec31ffa057f26de';
const hash=env=>env.ADMIN_PASSWORD_SHA256||defaultHash;
const secret=env=>env.AUTH_COOKIE_SECRET+':admin-v1:'+hash(env);
export async function adminIdentity(request,env){
  const user=await rawIdentity(request,env);
  if(!user)throw new CheckoutError('unauthenticated',401);
  const allowed=(env.COMMERCE_ADMIN_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(!allowed.includes(user.email.toLowerCase()))throw new CheckoutError('forbidden',403);
  return user;
}
export async function requireAdminAccess(request,env){
  const user=await adminIdentity(request,env);
  const token=await unseal(cookie(request,name),secret(env));
  if(!token||token.sub!==user.id||token.purpose!=='admin-orders')throw new CheckoutError('admin_locked',403);
  return user;
}
export async function grantAdmin(request,env,password){
  const user=await adminIdentity(request,env);
  if(typeof env.AUTH_COOKIE_SECRET!=='string'||env.AUTH_COOKIE_SECRET.length<32||!(/^[a-f0-9]{64}$/i.test(hash(env))))throw new CheckoutError('temporarily_unavailable',503);
  const now=Math.floor(Date.now()/1000),prior=await unseal(cookie(request,attempts),secret(env));
  if(prior?.sub===user.id&&prior.until>now)throw new CheckoutError('too_many_attempts',429);
  if(typeof password!=='string'||password.length>128)throw new CheckoutError('invalid_password',401);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password));
  const supplied=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  // Compare equal-length digests without a data-dependent early exit.
  const expected=hash(env).toLowerCase();let mismatch=0;
  for(let i=0;i<64;i++)mismatch|=supplied.charCodeAt(i)^expected.charCodeAt(i);
  const response=Response.json(mismatch?{error:'invalid_password'}:{ok:true},{status:mismatch?401:200});
  if(mismatch){
    const count=prior?.sub===user.id&&prior.start>now-900?prior.count+1:1;
    setCookie(response,attempts,await seal({sub:user.id,start:count===1?now:prior.start,count,until:count>=5?now+900:0,exp:now+900},secret(env)),900);
  }else{
    setCookie(response,name,await seal({sub:user.id,purpose:'admin-orders',exp:now+1800},secret(env)),1800);
    setCookie(response,attempts,'',0);
  }
  return response;
}
