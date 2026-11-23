import { storedDelivery } from '../checkout/_details.js';
import { dbFor,publicOrder } from '../checkout/_commerce.js';
import { readJson,reply,CheckoutError,requestOrigin } from '../checkout/_lib.js';
import { deliverNotification,simulationOrder,shippingDetails,discordURL } from '../checkout/_notifications.js';
import { requireAdminAccess } from './_access.js';

async function handle({request,env},post) {
  const invalid=requestOrigin(request,post);if(invalid)return invalid;
  try {
    await requireAdminAccess(request,env);
    const db=dbFor(env);if(!db?.prepare)throw new CheckoutError('temporarily_unavailable',503);
    if(!post){
      const before=new URL(request.url).searchParams.get('before');
      if(before!==null&&!/^\d{1,13}$/.test(before))throw new CheckoutError('invalid_request');
      // rowid is a stable pagination cursor even when multiple orders share a timestamp.
      const result=await db.prepare(`SELECT o.*,o.rowid AS cursor,n.status AS notification_status,n.last_error AS notification_error
        FROM shop_orders o LEFT JOIN shop_notifications n ON n.order_id=o.id
        WHERE o.rowid<? ORDER BY o.rowid DESC LIMIT 21`).bind(before?Number(before):Number.MAX_SAFE_INTEGER).all();
      const rows=result.results.slice(0,20);
      const pending=await db.prepare("SELECT id,status,last_error,created_at FROM shop_notifications WHERE status<>'sent' ORDER BY created_at LIMIT 20").bind().all();
      const totals=await db.prepare(`SELECT COUNT(*) orders,COALESCE(SUM(total_cents),0) sales,
        COALESCE(SUM((SELECT SUM(CAST(json_extract(value,'$.quantity') AS INTEGER)) FROM json_each(items_json))),0) units
        FROM shop_orders WHERE status='paid' AND mode='live'`).bind().first();
      const stock=await db.prepare('SELECT COALESCE(SUM(available),0) available FROM shop_inventory').bind().first();
      const daily=await db.prepare(`SELECT date(paid_at,'unixepoch') date,SUM(total_cents) cents FROM shop_orders
        WHERE status='paid' AND mode='live' AND paid_at>=unixepoch()-7*86400 GROUP BY date(paid_at,'unixepoch')`).bind().all();
      const today=new Date();const days=Array.from({length:7},(_,i)=>{
        const date=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()-6+i)).toISOString().slice(0,10);
        return {date,cents:daily.results.find(r=>r.date===date)?.cents||0};
      });
      return reply({orders:rows.map(o=>({...publicOrder(o),email:o.email,phone:storedDelivery(o)?.phone||'',
        shipping:shippingDetails(JSON.parse(o.fulfilment_json||'null'),o.method),paymentId:o.payment_id,
        notificationStatus:o.notification_status,notificationError:o.notification_error})),
        next:result.results.length>20?rows.at(-1).cursor:null,pending:pending.results,webhookConfigured:Boolean(env.DISCORD_ORDER_WEBHOOK_URL),
        metrics:{orders:totals.orders,salesCents:totals.sales,units:totals.units,stock:stock.available,days}});
    }
    const value=await readJson(request,{limit:1024});
    if(!value||typeof value!=='object'||Array.isArray(value))throw new CheckoutError('invalid_request');
    discordURL(env.DISCORD_ORDER_WEBHOOK_URL);
    if(value.action==='simulate'&&Object.keys(value).sort().join(',')==='action,key'&&/^[a-f0-9-]{36}$/.test(value.key)){
      const id='simulation-'+value.key;
      const existing=await db.prepare('SELECT id FROM shop_notifications WHERE id=? AND order_id IS NULL').bind(id).first();
      if(!existing){
        const row=await db.prepare(`INSERT INTO shop_notifications(id,simulation_json)
          SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM shop_notifications WHERE order_id IS NULL AND created_at>unixepoch()-60)
          RETURNING id`).bind(id,JSON.stringify(simulationOrder(id))).first();
        if(!row)throw new CheckoutError('test_rate_limited',429);
      }
      const sent=await deliverNotification(env,id);
      return reply({simulation:true,id,sent},sent?200:202);
    }
    if(value.action==='retry'&&Object.keys(value).sort().join(',')==='action,id'&&typeof value.id==='string'&&/^(?:dvn_[a-f0-9]{32}|simulation-[a-f0-9-]{36})$/.test(value.id)){
      return reply({sent:await deliverNotification(env,value.id)});
    }
    throw new CheckoutError('invalid_request');
  }catch(e){return reply({error:e instanceof CheckoutError?e.code:'temporarily_unavailable'},e instanceof CheckoutError?e.status:503);}
}
export const onRequestGet=c=>handle(c,false);
export const onRequestPost=c=>handle(c,true);
