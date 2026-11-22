import { customer, catalog, dbFor } from '../checkout/_commerce.js';
import { CheckoutError, normalizeCart, readJson, reply, requestOrigin } from '../checkout/_lib.js';
const canonical='COALESCE((SELECT email_id FROM account_links WHERE google_id=?1),?1)';

async function read(env,user) {
  const db=dbFor(env);
  // Only an explicitly verified account link permits migration of an older bag.
  await db.prepare(`INSERT OR IGNORE INTO account_carts(owner_id,items_json,version,updated_at)
    SELECT ${canonical},items_json,version,updated_at FROM account_carts
    WHERE owner_id=(SELECT google_id FROM account_links WHERE email_id=${canonical})`).bind(user.id).run();
  const row=await db.prepare(`SELECT items_json,version FROM account_carts WHERE owner_id=${canonical}`).bind(user.id).first();
  return {items:row?JSON.parse(row.items_json):[],version:row?.version||0};
}
async function handle({request,env},write) {
  const invalid=requestOrigin(request,write);if(invalid)return invalid;
  try {
    const user=await customer(request,env);
    if(!write)return reply(await read(env,user));
    const value=await readJson(request);
    if(!value||Object.keys(value).sort().join(',')!=='items,version'||!Number.isSafeInteger(value.version)||value.version<0)throw new CheckoutError('invalid_request');
    const items=Array.isArray(value.items)&&value.items.length===0?[]:
      normalizeCart({method:'card',items:value.items},catalog).items.map(({productId,size,quantity})=>({productId,size,quantity}));
    const row=await dbFor(env).prepare(`INSERT INTO account_carts(owner_id,items_json,version)
      SELECT ${canonical},?2,1 WHERE ?3=0
      ON CONFLICT(owner_id) DO NOTHING RETURNING version`).bind(user.id,JSON.stringify(items),value.version).first();
    const updated=row||await dbFor(env).prepare(`UPDATE account_carts SET items_json=?2,version=version+1,updated_at=unixepoch()
      WHERE owner_id=${canonical} AND version=?3 RETURNING version`).bind(user.id,JSON.stringify(items),value.version).first();
    if(!updated)return reply({error:'cart_conflict',...await read(env,user)},409);
    return reply({items,version:updated.version});
  }catch(e){return reply({error:e instanceof CheckoutError?e.code:'cart_unavailable'},e instanceof CheckoutError?e.status:503);}
}
export const onRequestGet=c=>handle(c,false);
export const onRequestPost=c=>handle(c,true);
