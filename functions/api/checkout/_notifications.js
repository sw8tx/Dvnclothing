import { catalog,dbFor } from './_commerce.js';
import { CheckoutError } from './_lib.js';

export function discordURL(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.hostname!=='discord.com'||url.port||url.username||url.password
      ||url.search||url.hash||!/^\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{40,200}$/.test(url.pathname))throw Error();
    url.searchParams.set('wait','true');return url.href;
  }catch{throw new CheckoutError('notification_not_configured',503);}
}
// Strip control characters and Discord markup from customer-controlled text.
const clean=(v,max=200)=>String(v??'').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').trim().slice(0,max).replace(/[`*_~<>|\\[\]()]/g,'\\$&');
const money=n=>(n/100).toFixed(2).replace('.',',')+' €';
export function shippingDetails(value,method) {
  const address=value?.address||{};
  return method==='paypal'?{
    name:value?.name?.full_name,line1:address.address_line_1,line2:address.address_line_2,
    city:address.admin_area_2,region:address.admin_area_1,postalCode:address.postal_code,country:address.country_code
  }:{name:value?.name,line1:address.line1,line2:address.line2,city:address.city,
    region:address.state,postalCode:address.postal_code,country:address.country};
}
export function validShipping(value,method) {
  const s=shippingDetails(value,method);
  return s.country==='DE'&&/^\d{5}$/.test(s.postalCode||'')
    &&['name','line1','city'].every(k=>typeof s[k]==='string'&&s[k].trim().length>0&&s[k].length<=200);
}
export function retainedShipping(value,method) {
  const s=shippingDetails(value,method),text=v=>typeof v==='string'?v.slice(0,200):'';
  // Allowlist fulfilment fields; never retain an entire payment-provider object.
  return method==='paypal'?{name:{full_name:text(s.name)},address:{address_line_1:text(s.line1),address_line_2:text(s.line2),
    admin_area_2:text(s.city),admin_area_1:text(s.region),postal_code:text(s.postalCode),country_code:text(s.country)}}:
    {name:text(s.name),address:{line1:text(s.line1),line2:text(s.line2),city:text(s.city),state:text(s.region),postal_code:text(s.postalCode),country:text(s.country)}};
}
export function notificationBody(order,{simulation=false}={}) {
  const items=JSON.parse(order.items_json).map(l=>`${l.quantity} × ${clean(catalog.products.find(p=>p.id===l.productId)?.name||l.productId,70)} · ${clean(l.size,5)} · ${money(l.unitPriceCents*l.quantity)}`);
  const fields=[
    {name:'Bestellnummer',value:clean(order.id,80)},
    ...Array.from({length:Math.ceil(items.length/7)},(_,i)=>({name:i?'Weitere Artikel':'Artikel',value:items.slice(i*7,i*7+7).join('\n')})),
    {name:'Beträge',value:`Artikel: ${money(order.subtotal_cents)}\nRabatt: ${money(order.discount_cents)}\nVersand: ${money(order.shipping_cents)}\nGesamt: ${money(order.total_cents)}`},
    {name:'Zahlung',value:(order.method==='paypal'?'PayPal':'Kredit-/Debitkarte über Stripe')+'\n'+(simulation?'Nur simuliert – keine Zahlung':order.mode==='test'?'Sandbox – keine echte Zahlung':'Zahlung vom Anbieter bestätigt')},
    {name:'Transaktion',value:clean(order.payment_id,100)||'Keine – Simulation'},
    {name:'Bestelldaten',value:'Kundenkontakt und Lieferadresse nur im geschützten Betreiberbereich einsehen.'}
  ];
  return {username:'DVN Bestellungen',allowed_mentions:{parse:[],users:[],roles:[]},embeds:[{
    title:simulation?'TESTBESTELLUNG – NICHT VERSENDEN':order.mode==='test'?'SANDBOX – NICHT VERSENDEN':'Neue bezahlte Bestellung',
    description:simulation?'Erfundene Daten. Keine Abbuchung, Bestellung oder Bestandsänderung.':'Im Betreiberbereich prüfen und nur bestätigte Live-Bestellungen versenden.',
    color:simulation||order.mode==='test'?0xe5a100:0x238636,fields,
    footer:{text:'DVN CLOTHING · Keine persönlichen Lieferdaten oder Zahlungsdaten'},
    timestamp:new Date((order.paid_at||order.created_at)*1000).toISOString()
  }]};
}
export function simulationOrder(id) {
  return {id,method:'card',mode:'test',email:'testkunde@example.invalid',
    items_json:JSON.stringify([{productId:'blue-mirage-black',size:'M',quantity:1,unitPriceCents:2000}]),
    subtotal_cents:2000,discount_cents:300,shipping_cents:490,total_cents:2190,
    fulfilment_json:JSON.stringify({name:'TESTPERSON – NICHT VERSENDEN',address:{line1:'Musterstraße 1',line2:'Nur Simulation',postal_code:'00000',city:'Musterstadt',country:'DE'}}),
    created_at:Math.floor(Date.now()/1000)};
}
export async function deliverNotification(env,id) {
  const url=discordURL(env.DISCORD_ORDER_WEBHOOK_URL),db=dbFor(env);
  const token=crypto.randomUUID();
  const job=await db.prepare(`UPDATE shop_notifications SET status='sending',attempts=attempts+1,lease_token=?,lease_until=unixepoch()+60
    WHERE id=? AND status<>'sent' AND retry_at<=unixepoch() AND (status='pending' OR lease_until<unixepoch()) RETURNING *`).bind(token,id).first();
  if(!job){
    const existing=await db.prepare('SELECT status FROM shop_notifications WHERE id=?').bind(id).first();
    return existing?.status==='sent';
  }
  let retry=60,category='notification_unavailable',stage='payload';
  try {
    const order=job.order_id?await db.prepare("SELECT * FROM shop_orders WHERE id=? AND status='paid'").bind(job.order_id).first():JSON.parse(job.simulation_json);
    if(!order)throw Error();
    const body=JSON.stringify(notificationBody(order,{simulation:!job.order_id}));
    stage='network';
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
      body,redirect:'manual',signal:AbortSignal.timeout(10000)});
    stage='response';
    if(!response.ok){
      category='discord_http_'+response.status;
      if(response.status===429){category='rate_limited';const info=await response.json().catch(()=>({}));retry=Math.min(86400,Math.max(60,Math.ceil(Number(info.retry_after)||60)));}
      else if([401,403,404].includes(response.status)){category='webhook_rejected';retry=3600;}
      throw Error();
    }
    const message=await response.json();
    stage='receipt';
    if(!/^\d{17,20}$/.test(message?.id||''))throw Error();
    stage='persistence';
    await db.prepare(`UPDATE shop_notifications SET status='sent',message_id=?,sent_at=unixepoch(),last_error=NULL,lease_token=NULL,lease_until=0
      WHERE id=? AND lease_token=?`).bind(message.id,id,token).run();
    return true;
  }catch(error){
    if(category==='notification_unavailable')category='notification_'+stage+(error?.name==='TimeoutError'?'_timeout':'_failed');
    // Never persist provider response bodies, webhook URLs or customer values in diagnostics.
    await db.prepare(`UPDATE shop_notifications SET status='pending',last_error=?,retry_at=unixepoch()+?,lease_token=NULL,lease_until=0
      WHERE id=? AND lease_token=?`).bind(category,retry,id,token).run();
    return false;
  }
}
export async function notifyPaid(env,id) {
  if(!env.DISCORD_ORDER_WEBHOOK_URL)return; // Release readiness requires configuration for new checkouts.
  if(!await deliverNotification(env,id))throw new CheckoutError('notification_pending',503);
}
