import { dbFor } from './_commerce.js';
import { reply,requestOrigin } from './_lib.js';
// The outer middleware requires the preview cookie; customer identity is not
// needed to view stock. Never expose account or order records here.
export async function onRequestGet({request,env}) {
  const invalid=requestOrigin(request);if(invalid)return invalid;
  try {
    const rows=await dbFor(env).prepare('SELECT product_id,size,available FROM shop_inventory').bind().all();
    return reply({stock:rows.results.map(r=>({productId:r.product_id,size:r.size,available:r.available}))});
  }catch{return reply({error:'inventory_unavailable'},503);}
}
