const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const site='https://dvnclothing.com',secret='commerce-test-cookie-secret-32-characters';
function database(){
  const sqlite=new DatabaseSync(':memory:');
  for(const name of ['0002_profiles','0003_welcome_bonus','0004_account_links','0006_commerce','0007_order_notifications','0008_checkout_details'])sqlite.exec(fs.readFileSync(require.resolve('../migrations/'+name+'.sql'),'utf8'));
  const binding={prepare(sql){const stmt=sqlite.prepare(sql);return {bind(...args){return {
    first:async()=>stmt.get(...args)||null,
    all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:stmt.run(...args)})};}};}};
  return {sqlite,env:{DVN_AUTH_DB:binding,AUTH_COOKIE_SECRET:secret}};
}
const delivery=()=>({firstName:'Test',lastName:'Person',line1:'Musterstraße 1',line2:'',postalCode:'12345',city:'Musterstadt',country:'DE',phone:''});
const selection=(quantity=1,method='card',code='')=>({method,code,delivery:delivery(),items:[{productId:'blue-mirage-black',size:'M',quantity}]});
async function user(email='one@example.test',sub='email:'+email){
  return (await import('../functions/api/auth/_profile.js')).identityFromClaims({email,sub});
}
async function request(path,body,email='one@example.test',sub='email:'+email){
  const {seal}=await import('../functions/api/auth/_lib.js');
  return new Request(site+path,{method:body?'POST':'GET',headers:{Origin:site,'Content-Type':'application/json',
    Cookie:'__Host-dvn-session='+await seal({email,sub,exp:Math.floor(Date.now()/1000)+3600},secret)},body:body?JSON.stringify(body):undefined});
}
async function adminRequest(env,path,body,email='account@dvnclothing.com'){
  const original=await request(path,body,email);
  const {grantAdmin}=await import('../functions/api/admin/_access.js');
  const granted=await grantAdmin(original,env,'dvnclothing');
  assert.equal(granted.status,200);
  const headers=new Headers(original.headers);
  headers.set('Cookie',headers.get('Cookie')+'; '+granted.headers.get('Set-Cookie').split(';')[0]);
  return new Request(original,{headers});
}
async function bonus(db,u){const {digest}=await import('../functions/api/checkout/_commerce.js');
  db.sqlite.prepare('INSERT INTO welcome_bonuses(email_key,owner_id,code) VALUES(?,?,?)').run(await digest('dvn-welcome-v1:'+u.email),u.id,'DVN-WELCOME');}
function activeEnv(env){return {...env,COMMERCE_ENABLED:'true',COMMERCE_MODE:'test',STRIPE_CHECKOUT_TEST_SECRET_KEY:'sk_test_checkout',
  STRIPE_CHECKOUT_WEBHOOK_SECRET:'whsec_test',PAYPAL_CHECKOUT_CLIENT_ID:'test-client',PAYPAL_CHECKOUT_CLIENT_SECRET:'test-secret',PAYPAL_MERCHANT_ID:'merchant',PAYPAL_WEBHOOK_ID:'webhook'};}
test('confirmed stock is exactly 5 per size and migration replay never restocks sold units',()=>{
  const db=database();assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,75);
  db.sqlite.exec("UPDATE shop_inventory SET available=2 WHERE product_id='blue-mirage-black' AND size='M'");
  db.sqlite.exec(fs.readFileSync(require.resolve('../migrations/0006_commerce.sql'),'utf8'));
  assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,72);db.sqlite.close();
});
test('checkout cannot open with missing secrets, sandbox bonus credentials, early launch or unreviewed legal setup',async()=>{
  const {configured}=await import('../functions/api/checkout/_commerce.js'),db=database(),env=activeEnv(db.env);
  assert.equal(configured(db.env),false);assert.equal(configured(env),true);
  for(const key of ['STRIPE_CHECKOUT_TEST_SECRET_KEY','STRIPE_CHECKOUT_WEBHOOK_SECRET','PAYPAL_CHECKOUT_CLIENT_SECRET','PAYPAL_MERCHANT_ID','PAYPAL_WEBHOOK_ID'])assert.equal(configured({...env,[key]:''}),false,key);
  assert.equal(configured({...env,STRIPE_CHECKOUT_TEST_SECRET_KEY:'',STRIPE_TEST_SECRET_KEY:'sk_test_bonus'}),false);
  const live={...env,COMMERCE_MODE:'live',STRIPE_LIVE_SECRET_KEY:'sk_live_test'};
  assert.equal(configured(live,Date.parse('2027-01-01')),false);
  assert.equal(configured({...live,COMMERCE_LEGAL_READY:'true'},Date.parse('2026-11-22')),false);
  assert.equal(configured({...live,COMMERCE_LEGAL_READY:'true'},Date.parse('2027-01-01')),true);db.sqlite.close();
});
test('server applies 15 percent to products only and rejects stolen, retired and reused codes',async()=>{
  const {quote,reserve}=await import('../functions/api/checkout/_commerce.js'),db=database(),u=await user();await bonus(db,u);
  const q=await quote(db.env,u,selection(2,'paypal','dvn-welcome'));
  assert.equal(q.subtotalCents,4000);assert.equal(q.discountCents,600);assert.equal(q.shippingCents,490);assert.equal(q.totalCents,3890);
  await assert.rejects(quote(db.env,await user('other@example.test'),selection(1,'card','DVN-WELCOME')),{code:'discount_unavailable'});
  const o=await reserve(db.env,u,selection(1,'card','DVN-WELCOME'));
  db.sqlite.prepare("UPDATE shop_orders SET status='paid' WHERE id=?").run(o.id);
  await assert.rejects(quote(db.env,u,selection(1,'card','DVN-WELCOME')),{code:'discount_unavailable'});db.sqlite.close();
});
test('concurrent reservations cannot oversell; idempotent retries keep the same order and reserve only once',async()=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),db=database(),u=await user();
  const same=await Promise.all([reserve(db.env,u,selection(3)),reserve(db.env,u,selection(3))]);assert.equal(same[0].id,same[1].id);
  assert.equal(db.sqlite.prepare("SELECT available FROM shop_inventory WHERE product_id='blue-mirage-black' AND size='M'").get().available,2);
  await assert.rejects(reserve(db.env,await user('two@example.test'),selection(3)),{code:'stock_unavailable'});
  await assert.rejects(reserve(db.env,u,selection(2)),{code:'pending_order'});db.sqlite.close();
});
test('multi-line reservation rolls back all quantities on insufficient stock',async()=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),db=database();
  const input=selection();input.items.push({productId:'blue-sunshine',size:'S',quantity:6});
  await assert.rejects(reserve(db.env,await user(),input),{code:'stock_unavailable'});
  assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,75);db.sqlite.close();
});
test('cancellation restores reserved stock exactly once; an unknown capture keeps stock held',async()=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),db=database(),u=await user();
  const o=await reserve(db.env,u,selection(2));
  db.sqlite.prepare("UPDATE shop_orders SET status='pending' WHERE id=?").run(o.id);
  db.sqlite.prepare("UPDATE shop_orders SET status='cancelled' WHERE id=?").run(o.id);
  db.sqlite.prepare("UPDATE shop_orders SET status='cancelled' WHERE id=?").run(o.id);
  assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,75);
  const next=await reserve(db.env,u,selection(2));db.sqlite.prepare("UPDATE shop_orders SET status='capturing' WHERE id=?").run(next.id);
  db.sqlite.prepare("UPDATE shop_orders SET status='cancelled' WHERE id=? AND status='pending'").run(next.id);
  assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,73);db.sqlite.close();
});
test('a matching email alone grants neither order nor discount access; a proven link does',async()=>{
  const {reserve,getOrder,quote}=await import('../functions/api/checkout/_commerce.js'),db=database();
  const g=await user('one@example.test','google-one'),e=await user();await bonus(db,g);
  const o=await reserve(db.env,g,selection());
  await assert.rejects(getOrder(db.env,e,o.id),{code:'not_found'});
  await assert.rejects(quote(db.env,e,selection(1,'card','DVN-WELCOME')),{code:'discount_unavailable'});
  db.sqlite.prepare('INSERT INTO account_links(google_id,email_id,default_name) VALUES(?,?,?)').run(g.id,e.id,'One');
  assert.equal((await getOrder(db.env,e,o.id)).id,o.id);
  assert.equal((await quote(db.env,e,selection(1,'card','DVN-WELCOME'))).discountCents,300);db.sqlite.close();
});
test('account carts persist, isolate accounts, reject stale writes and migrate only verified aliases',async()=>{
  const {onRequestGet,onRequestPost}=await import('../functions/api/account/cart.js'),db=database();
  const call=async(body,email,sub)=>{const r=await (body?onRequestPost:onRequestGet)({env:db.env,request:await request('/api/account/cart',body,email,sub)});return {status:r.status,data:await r.json()};};
  assert.deepEqual((await call()).data,{items:[],version:0});
  const items=selection().items;
  assert.equal((await call({items,version:0})).data.version,1);
  assert.equal((await call({items:[],version:0})).status,409);
  assert.deepEqual((await call()).data.items,items);
  assert.deepEqual((await call(undefined,'two@example.test')).data.items,[]);
  assert.equal((await call({items:[],version:1})).data.version,2);
  const g=await user('three@example.test','google-three'),e=await user('three@example.test');
  await call({items,version:0},g.email,'google-three');
  assert.deepEqual((await call(undefined,e.email)).data.items,[]);
  db.sqlite.prepare('INSERT INTO account_links(google_id,email_id,default_name) VALUES(?,?,?)').run(g.id,e.id,'Three');
  assert.deepEqual((await call(undefined,e.email)).data.items,items);db.sqlite.close();
});
test('Stripe proof verifies identity, amount, currency, mode and German shipping before fulfilment',async()=>{
  const {validateStripe}=await import('../functions/api/checkout/_providers.js');
  const order={id:'order',provider_id:'cs_test_1',mode:'test',total_cents:2490};
  const session={id:'cs_test_1',client_reference_id:'order',metadata:{dvn_order_id:'order'},livemode:false,currency:'eur',amount_total:2490,payment_status:'paid',status:'complete',payment_intent:'pi_1',collected_information:{shipping_details:{name:'Testkunde',address:{country:'DE',postal_code:'12345',city:'Musterstadt',line1:'Musterstraße 1'}}}};
  assert.equal(validateStripe(order,session).paymentId,'pi_1');
  for(const patch of [{amount_total:1},{currency:'usd'},{livemode:true},{id:'other'},{client_reference_id:'other'},{payment_status:'unpaid'},{status:'open'},{collected_information:{shipping_details:{address:{country:'FR'}}}}])assert.throws(()=>validateStripe(order,{...session,...patch}),{code:'payment_verification_failed'});
});
test('PayPal proof rejects wrong merchant, pending capture, partial and duplicate captures',async()=>{
  const {validatePayPal}=await import('../functions/api/checkout/_providers.js');
  const order={id:'order',provider_id:'PP1',total_cents:2490};
  const result={id:'PP1',status:'COMPLETED',purchase_units:[{custom_id:'order',payee:{merchant_id:'merchant'},shipping:{name:{full_name:'Testkunde'},address:{country_code:'DE',postal_code:'12345',admin_area_2:'Musterstadt',address_line_1:'Musterstraße 1'}},payments:{captures:[{id:'CAP1',status:'COMPLETED',amount:{currency_code:'EUR',value:'24.90'}}]}}]};
  assert.equal(validatePayPal(order,result,'merchant').paymentId,'CAP1');
  assert.throws(()=>validatePayPal(order,result,'another'),{code:'payment_verification_failed'});
  for(const change of [r=>r.purchase_units[0].payments.captures[0].status='PENDING',r=>r.purchase_units[0].payments.captures[0].amount.value='1.00',r=>r.purchase_units[0].payments.captures.push(r.purchase_units[0].payments.captures[0]),r=>r.purchase_units[0].shipping.address.country_code='US']){const copy=structuredClone(result);change(copy);assert.throws(()=>validatePayPal(order,copy,'merchant'),{code:'payment_verification_failed'});}
});
test('Stripe raw-body signature rejects payload tampering, wrong secrets and old replay',async()=>{
  const {verifyStripeSignature}=await import('../functions/api/payments/stripe.js');
  const raw='{"id":"evt_1"}',now=Date.now(),ts=Math.floor(now/1000),secret='whsec_test';
  const sig=require('node:crypto').createHmac('sha256',secret).update(ts+'.'+raw).digest('hex');
  assert.equal(await verifyStripeSignature(raw,`t=${ts},v1=${sig}`,secret,now),true);
  assert.equal(await verifyStripeSignature(raw+' ',`t=${ts},v1=${sig}`,secret,now),false);
  assert.equal(await verifyStripeSignature(raw,`t=${ts},v1=${sig}`,'whsec_other',now),false);
  assert.equal(await verifyStripeSignature(raw,`t=${ts},v1=${sig}`,secret,now+301000),false);
});
test('Stripe checkout charges exact discounted cents and only server-owned return URLs',async t=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),{createPayment}=await import('../functions/api/checkout/_providers.js');
  const db=database(),u=await user();await bonus(db,u);const env=activeEnv(db.env),o=await reserve(env,u,selection(3,'card','DVN-WELCOME'));
  let calls=0;t.mock.method(globalThis,'fetch',async(url,opts)=>{calls++;if(url==='https://api.stripe.com/v1/customers'){assert.equal(opts.body.get('shipping[address][postal_code]'),'12345');assert.equal(opts.body.get('email'),u.email);assert.equal(opts.headers['Idempotency-Key'],o.id+'-customer');return Response.json({id:'cus_fixture'});}assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');assert.equal(opts.body.get('customer'),'cus_fixture');assert.equal(opts.body.has('customer_email'),false);
    const form=opts.body;let amount=0;for(let i=0;i<3;i++)amount+=Number(form.get(`line_items[${i}][price_data][unit_amount]`));
    assert.equal(amount+Number(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')),o.total_cents);
    assert.equal(form.get('success_url'),site+'/api/payments/return?order='+o.id);assert.equal(opts.headers['Idempotency-Key'],o.id+'-create');
    return Response.json({id:'cs_test_1',url:'https://checkout.stripe.com/c/pay/cs_test_1'});
  });
  await createPayment(env,o);const updated=db.sqlite.prepare('SELECT * FROM shop_orders WHERE id=?').get(o.id);
  await createPayment(env,updated);assert.equal(calls,2);db.sqlite.close();
});
test('duplicate Stripe notifications mark paid once without reserving additional stock',async t=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),{reconcile}=await import('../functions/api/checkout/_providers.js');
  const db=database(),env=activeEnv(db.env),o=await reserve(env,await user(),selection());
  db.sqlite.prepare("UPDATE shop_orders SET provider_id='cs_test_1',status='pending' WHERE id=?").run(o.id);
  const read=()=>db.sqlite.prepare('SELECT * FROM shop_orders WHERE id=?').get(o.id);
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'cs_test_1',client_reference_id:o.id,metadata:{dvn_order_id:o.id},livemode:false,currency:'eur',amount_total:2490,payment_status:'paid',status:'complete',payment_intent:'pi_1',shipping_details:{name:'Testkunde',address:{country:'DE',postal_code:'12345',city:'Musterstadt',line1:'Musterstraße 1'}}}));
  await reconcile(env,read());await reconcile(env,read());assert.equal(read().status,'paid');
  assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,74);db.sqlite.close();
});
test('PayPal capture timeout retains stock and cannot charge a second time',async t=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),{reconcile}=await import('../functions/api/checkout/_providers.js');
  const db=database(),env=activeEnv(db.env),o=await reserve(env,await user(),selection(1,'paypal'));
  db.sqlite.prepare("UPDATE shop_orders SET provider_id='PP1',status='pending' WHERE id=?").run(o.id);
  const read=()=>db.sqlite.prepare('SELECT * FROM shop_orders WHERE id=?').get(o.id);let captures=0;
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/token'))return Response.json({access_token:'token'});
    if(url.endsWith('/capture')){captures++;throw Error('network lost');}
    return Response.json({id:'PP1',status:'APPROVED',purchase_units:[{custom_id:o.id,amount:{currency_code:'EUR',value:'24.90'},payee:{merchant_id:'merchant'},shipping:{name:{full_name:'Testkunde'},address:{country_code:'DE',postal_code:'12345',admin_area_2:'Musterstadt',address_line_1:'Musterstraße 1'}}}]});
  });
  await assert.rejects(reconcile(env,read(),{capture:true}),{code:'payment_unavailable'});
  await reconcile(env,read(),{capture:true});await reconcile(env,read(),{cancel:true});
  assert.equal(captures,1);assert.equal(read().status,'capturing');assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,74);db.sqlite.close();
});
test('a paid order clears only the exact purchased cart, never newer selections',async()=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),db=database(),u=await user();
  const items=selection().items;
  db.sqlite.prepare('INSERT INTO account_carts(owner_id,items_json) VALUES(?,?)').run(u.id,JSON.stringify(items));
  const first=await reserve(db.env,u,selection());
  db.sqlite.prepare("UPDATE shop_orders SET status='paid' WHERE id=?").run(first.id);
  assert.deepEqual(JSON.parse(db.sqlite.prepare('SELECT items_json FROM account_carts WHERE owner_id=?').get(u.id).items_json),[]);
  assert.equal(db.sqlite.prepare('SELECT version FROM account_carts WHERE owner_id=?').get(u.id).version,2);
  db.sqlite.prepare('UPDATE account_carts SET items_json=? WHERE owner_id=?').run(JSON.stringify(selection(2).items),u.id);
  const next=await reserve(db.env,u,selection());db.sqlite.prepare("UPDATE shop_orders SET status='paid' WHERE id=?").run(next.id);
  assert.equal(JSON.parse(db.sqlite.prepare('SELECT items_json FROM account_carts WHERE owner_id=?').get(u.id).items_json)[0].quantity,2);db.sqlite.close();
});

const fakeWebhook='https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
test('shipping proof requires a usable address and retains only fulfilment fields',async()=>{
  const {validShipping,retainedShipping}=await import('../functions/api/checkout/_notifications.js');
  const shipping={name:'Testkunde',address:{country:'DE',postal_code:'12345',city:'Stadt',line1:'Straße 1'},card_number:'never-store',phone:'unneeded'};
  assert.equal(validShipping(shipping,'card'),true);
  for(const key of ['name','line1','city','postal_code']){const copy=structuredClone(shipping);if(key==='name')copy.name='';else copy.address[key]='';assert.equal(validShipping(copy,'card'),false,key);}
  const safe=retainedShipping(shipping,'card');assert.equal(safe.card_number,undefined);assert.equal(safe.phone,undefined);assert.equal(safe.address.line1,'Straße 1');
});
test('Discord destination rejects non-Discord hosts, redirects, ports and injected query parameters',async()=>{
  const {discordURL}=await import('../functions/api/checkout/_notifications.js');
  assert.equal(discordURL(fakeWebhook),fakeWebhook+'?wait=true');
  for(const url of ['https://evil.test/api/webhooks/123/abc',fakeWebhook+'?thread_id=1',fakeWebhook+'#fragment',fakeWebhook.replace('discord.com','discord.com.evil.test'),fakeWebhook.replace('https:','http:'),fakeWebhook.replace('discord.com','name@discord.com'),fakeWebhook.replace('discord.com','discord.com:444')])assert.throws(()=>discordURL(url),{code:'notification_not_configured'});
});
test('Discord embeds contain no personal fulfilment data; simulations never claim a payment',async()=>{
  const {notificationBody,simulationOrder}=await import('../functions/api/checkout/_notifications.js');
  const order=simulationOrder('simulation-example');order.email='test@example.invalid';
  order.checkout_details_json=JSON.stringify({...delivery(),phone:'+49123456789'});
  const body=notificationBody(order,{simulation:true});assert.deepEqual(body.allowed_mentions,{parse:[],users:[],roles:[]});
  assert.match(body.embeds[0].title,/TESTBESTELLUNG/);
  assert.doesNotMatch(JSON.stringify(body),/test@example.invalid|Musterstraße|Musterstadt|TESTPERSON|49123456789|card_number|cvv|client_secret/);
  assert.match(body.embeds[0].description,/Keine Abbuchung/);
});
test('paid transition atomically creates one durable Discord job, including after migration replay',async()=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),db=database(),u=await user();
  const o=await reserve(db.env,u,selection());assert.equal(db.sqlite.prepare('SELECT count(*) n FROM shop_notifications').get().n,0);
  db.sqlite.prepare("UPDATE shop_orders SET status='paid' WHERE id=?").run(o.id);db.sqlite.prepare("UPDATE shop_orders SET status='paid' WHERE id=?").run(o.id);
  db.sqlite.exec(fs.readFileSync(require.resolve('../migrations/0007_order_notifications.sql'),'utf8'));
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM shop_notifications').get().n,1);assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,74);db.sqlite.close();
});
test('Discord failures leave paid orders intact; duplicate payment events retry the same outbox job',async t=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),{reconcile}=await import('../functions/api/checkout/_providers.js');
  const db=database(),env={...activeEnv(db.env),DISCORD_ORDER_WEBHOOK_URL:fakeWebhook},o=await reserve(env,await user(),selection());
  db.sqlite.prepare("UPDATE shop_orders SET provider_id='cs_test_1',status='pending' WHERE id=?").run(o.id);
  const read=()=>db.sqlite.prepare('SELECT * FROM shop_orders WHERE id=?').get(o.id);let discord=0;
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.startsWith('https://discord.com/')){discord++;return discord===1?new Response('',{status:503}):Response.json({id:'123456789012345679'});}
    return Response.json({id:'cs_test_1',client_reference_id:o.id,metadata:{dvn_order_id:o.id},livemode:false,currency:'eur',amount_total:2490,payment_status:'paid',status:'complete',payment_intent:'pi_1',shipping_details:{name:'Testkunde',address:{country:'DE',postal_code:'12345',city:'Musterstadt',line1:'Musterstraße 1'}}});
  });
  await assert.rejects(reconcile(env,read()),{code:'notification_pending'});assert.equal(read().status,'paid');
  assert.equal(db.sqlite.prepare('SELECT status FROM shop_notifications').get().status,'pending');
  db.sqlite.exec('UPDATE shop_notifications SET retry_at=0');await reconcile(env,read());await reconcile(env,read());
  assert.equal(discord,2);assert.equal(db.sqlite.prepare('SELECT status FROM shop_notifications').get().status,'sent');
  assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,74);db.sqlite.close();
});
test('outbox claim prevents simultaneous Discord delivery and respects rate-limit backoff',async t=>{
  const {deliverNotification,simulationOrder}=await import('../functions/api/checkout/_notifications.js');
  const db=database(),env={...db.env,DISCORD_ORDER_WEBHOOK_URL:fakeWebhook};
  db.sqlite.prepare('INSERT INTO shop_notifications(id,simulation_json) VALUES(?,?)').run('test',JSON.stringify(simulationOrder('test')));
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({retry_after:120},{status:429});});
  await Promise.all([deliverNotification(env,'test'),deliverNotification(env,'test')]);assert.equal(calls,1);
  await deliverNotification(env,'test');assert.equal(calls,1);
  const row=db.sqlite.prepare('SELECT * FROM shop_notifications').get();assert.equal(row.last_error,'rate_limited');assert.ok(row.retry_at>=Math.floor(Date.now()/1000)+118);assert.equal(row.lease_token,null);db.sqlite.close();
});
test('admin routes deny anonymous and other accounts, enforce Origin and never use preview password as admin',async()=>{
  const {onRequestGet,onRequestPost}=await import('../functions/api/admin/orders.js'),db=database();
  const env={...db.env,COMMERCE_ADMIN_EMAILS:'owner@example.test',DISCORD_ORDER_WEBHOOK_URL:fakeWebhook};
  assert.equal((await onRequestGet({env,request:new Request(site+'/api/admin/orders')})).status,401);
  assert.equal((await onRequestGet({env,request:await request('/api/admin/orders')})).status,403);
  assert.equal((await onRequestPost({env,request:new Request(site+'/api/admin/orders',{method:'POST',headers:{Origin:'https://evil.test'}})})).status,403);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM shop_notifications').get().n,0);db.sqlite.close();
});
test('admin dashboard requires owner session and a short-lived password proof',async()=>{
  const {onRequestPost}=await import('../functions/api/admin/access.js');
  const {onRequestGet}=await import('../functions/api/admin/orders.js');
  const db=database(),env={...db.env,COMMERCE_ADMIN_EMAILS:'one@example.test'};
  const call=async(password,email='account@dvnclothing.com')=>onRequestPost({env,request:await request('/api/admin/access',{password},email)});
  assert.equal((await onRequestGet({env,request:await request('/api/admin/orders')})).status,403);
  assert.equal((await call('wrong')).status,401);
  assert.equal((await call('dvnclothing','other@example.test')).status,403);
  // A legacy environment allowlist cannot grant access to another mailbox.
  assert.equal((await call('dvnclothing','one@example.test')).status,403);
  assert.equal((await call('dvnclothing','account+dvn@dvnclothing.com')).status,403);
  const proof=await call('dvnclothing');assert.equal(proof.status,200);
  const granted=await adminRequest(env,'/api/admin/orders');assert.equal((await onRequestGet({env,request:granted})).status,200);
  const foreign=await request('/api/admin/orders',null,'other@example.test');
  foreign.headers.set('Cookie',foreign.headers.get('Cookie')+'; '+proof.headers.get('Set-Cookie').split(';')[0]);
  assert.equal((await onRequestGet({env,request:foreign})).status,403);db.sqlite.close();
});
test('operator simulation is idempotent, rate limited and cannot write orders or change stock',async t=>{
  const {onRequestGet,onRequestPost}=await import('../functions/api/admin/orders.js'),db=database();
  const env={...db.env,COMMERCE_ADMIN_EMAILS:'one@example.test',DISCORD_ORDER_WEBHOOK_URL:fakeWebhook};let calls=0;
  t.mock.method(globalThis,'fetch',async(url,opts)=>{calls++;assert.equal(url,fakeWebhook+'?wait=true');const body=JSON.parse(opts.body);assert.match(body.embeds[0].title,/TESTBESTELLUNG/);return Response.json({id:'123456789012345679'});});
  const body={action:'simulate',key:crypto.randomUUID()},call=async value=>onRequestPost({env,request:await adminRequest(env,'/api/admin/orders',value)});
  assert.equal((await call(body)).status,200);assert.equal((await call(body)).status,200);assert.equal(calls,1);
  assert.equal((await call({...body,key:crypto.randomUUID()})).status,429);
  assert.equal((await call({...body,email:'evil@example.test'})).status,400);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM shop_orders').get().n,0);assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,75);
  const data=await (await onRequestGet({env,request:await adminRequest(env,'/api/admin/orders')})).json();assert.deepEqual(data.orders,[]);assert.equal(data.webhookConfigured,true);assert.equal(data.metrics.salesCents,0);assert.doesNotMatch(JSON.stringify(data),/abcdefghijklmnopqrstuvwxyz|AUTH_COOKIE_SECRET/);db.sqlite.close();
});
test('administrator sees shipping while customer order responses never expose recipient details',async()=>{
  const {onRequestGet}=await import('../functions/api/admin/orders.js'),{reserve,publicOrder}=await import('../functions/api/checkout/_commerce.js');
  const db=database(),env={...db.env,COMMERCE_ADMIN_EMAILS:'one@example.test'},o=await reserve(env,await user('buyer@example.test'),selection());
  db.sqlite.prepare("UPDATE shop_orders SET status='paid',fulfilment_json=? WHERE id=?").run(JSON.stringify({name:'Recipient',address:{country:'DE',postal_code:'12345',city:'Stadt',line1:'Straße 1'}}),o.id);
  const row=db.sqlite.prepare('SELECT * FROM shop_orders WHERE id=?').get(o.id);assert.equal(publicOrder(row).email,undefined);assert.equal(publicOrder(row).fulfilment_json,undefined);
  const data=await (await onRequestGet({env,request:await adminRequest(env,'/api/admin/orders')})).json();assert.equal(data.orders[0].email,'buyer@example.test');assert.equal(data.orders[0].shipping.name,'Recipient');assert.equal(data.metrics.salesCents,0);db.sqlite.close();
});
test('a Discord outage does not turn a paid customer order into a failed checkout response',async t=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),{onRequestPost}=await import('../functions/api/checkout/order.js');
  const db=database(),env={...db.env,DISCORD_ORDER_WEBHOOK_URL:fakeWebhook},o=await reserve(env,await user(),selection());
  db.sqlite.prepare("UPDATE shop_orders SET status='paid' WHERE id=?").run(o.id);
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
  const response=await onRequestPost({env,request:await request('/api/checkout/order',{action:'refresh',id:o.id})});
  assert.equal(response.status,200);assert.equal((await response.json()).order.status,'paid');db.sqlite.close();
});

test('outbound integrations use Workers-compatible manual redirects and reject 302 without forwarding credentials',async t=>{
  const {stripe,paypal}=await import('../functions/api/checkout/_providers.js');
  const {retireTestPromotion}=await import('../functions/api/account/_stripe.js');
  const {deliverNotification,simulationOrder}=await import('../functions/api/checkout/_notifications.js');
  const db=database();let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://untrusted.example/collect'}});
  });
  const env={...activeEnv(db.env),DISCORD_ORDER_WEBHOOK_URL:fakeWebhook,STRIPE_TEST_SECRET_KEY:'sk_test_fixture'};
  await assert.rejects(stripe(env,'test','checkout/sessions'),{code:'payment_unavailable'});
  await assert.rejects(paypal(env,'test','/v2/checkout/orders'),{code:'payment_unavailable'});
  await assert.rejects(retireTestPromotion(env,'TEST'),/Stripe sandbox request failed/);
  db.sqlite.prepare('INSERT INTO shop_notifications(id,simulation_json) VALUES(?,?)').run('redirect',JSON.stringify(simulationOrder('redirect')));
  assert.equal(await deliverNotification(env,'redirect'),false);
  assert.equal(db.sqlite.prepare('SELECT status,last_error FROM shop_notifications').get().last_error,'discord_http_302');
  assert.equal(calls,4);db.sqlite.close();
});

test('delivery validation rejects incomplete or injected fields before reserving stock; contacts stay private',async()=>{
  const {deliveryDetails}=await import('../functions/api/checkout/_details.js');
  const {reserve,publicOrder}=await import('../functions/api/checkout/_commerce.js');
  const db=database(),u=await user();
  for(const bad of [undefined,{...delivery(),line1:' '},{...delivery(),postalCode:'1234'},{...delivery(),country:'US'},
    {...delivery(),firstName:'a\nb'},{...delivery(),cardNumber:'4111111111111111'},{...delivery(),email:'attacker@example.test'},
    {...delivery(),phone:'abc123'},{...delivery(),phone:'1234567890123456'}]){
    assert.throws(()=>deliveryDetails(bad));
    await assert.rejects(reserve(db.env,u,{...selection(),delivery:bad}));
  }
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM shop_orders').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT sum(available) n FROM shop_inventory').get().n,75);
  const input={...selection(),delivery:{...delivery(),phone:'+49 (123) 456789'}};
  const order=await reserve(db.env,u,input);assert.equal(JSON.parse(order.checkout_details_json).phone,'+49123456789');
  assert.equal((await reserve(db.env,u,input)).id,order.id);
  await assert.rejects(reserve(db.env,u,{...input,delivery:{...input.delivery,line1:'Andere Straße 2'}}),{code:'pending_order'});
  assert.equal(publicOrder(order).checkout_details_json,undefined);assert.equal(publicOrder(order).phone,undefined);
  assert.equal(order.email,u.email);db.sqlite.close();
});

test('PayPal receives the entered address and fixes shipping to that address',async t=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js');const {createPayment}=await import('../functions/api/checkout/_providers.js');
  const db=database(),env=activeEnv(db.env),order=await reserve(env,await user(),selection(1,'paypal'));
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.endsWith('/v1/oauth2/token'))return Response.json({access_token:'test'});
    const body=JSON.parse(options.body);assert.equal(body.payment_source.paypal.experience_context.shipping_preference,'SET_PROVIDED_ADDRESS');
    assert.equal(body.purchase_units[0].shipping.name.full_name,'Test Person');assert.equal(body.purchase_units[0].shipping.address.address_line_1,'Musterstraße 1');
    return Response.json({id:'PPaddress',links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=PPaddress'}]});
  });
  await createPayment(env,order);db.sqlite.close();
});

test('optional delivery telephone remains in protected order details',async()=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js');
  const {onRequestGet}=await import('../functions/api/admin/orders.js');
  const db=database(),env={...activeEnv(db.env),COMMERCE_ADMIN_EMAILS:'owner@example.test'},u=await user('account@dvnclothing.com');
  const input=selection();input.delivery={...delivery(),phone:'+49123456789'};
  const order=await reserve(env,u,input);
  db.sqlite.prepare("UPDATE shop_orders SET status='paid',fulfilment_json=? WHERE id=?").run(JSON.stringify({name:'Test Person',address:{line1:'Musterstraße 1',city:'Musterstadt',postal_code:'12345',country:'DE'}}),order.id);
  const response=await onRequestGet({env,request:await adminRequest(env,'/api/admin/orders',null,u.email)});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.orders[0].phone,'+49123456789');
  assert.equal(body.orders[0].shipping.address?.line1,undefined);assert.equal(body.orders[0].shipping.line1,'Musterstraße 1');db.sqlite.close();
});
