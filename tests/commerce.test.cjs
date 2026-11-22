const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const site='https://dvnclothing.com',secret='commerce-test-cookie-secret-32-characters';
function database(){
  const sqlite=new DatabaseSync(':memory:');
  for(const name of ['0002_profiles','0003_welcome_bonus','0004_account_links','0006_commerce'])sqlite.exec(fs.readFileSync(require.resolve('../migrations/'+name+'.sql'),'utf8'));
  const binding={prepare(sql){const stmt=sqlite.prepare(sql);return {bind(...args){return {
    first:async()=>stmt.get(...args)||null,
    all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:stmt.run(...args)})};}};}};
  return {sqlite,env:{DVN_AUTH_DB:binding,AUTH_COOKIE_SECRET:secret}};
}
const selection=(quantity=1,method='card',code='')=>({method,code,items:[{productId:'blue-mirage-black',size:'M',quantity}]});
async function user(email='one@example.test',sub='email:'+email){
  return (await import('../functions/api/auth/_profile.js')).identityFromClaims({email,sub});
}
async function request(path,body,email='one@example.test',sub='email:'+email){
  const {seal}=await import('../functions/api/auth/_lib.js');
  return new Request(site+path,{method:body?'POST':'GET',headers:{Origin:site,'Content-Type':'application/json',
    Cookie:'__Host-dvn-session='+await seal({email,sub,exp:Math.floor(Date.now()/1000)+3600},secret)},body:body?JSON.stringify(body):undefined});
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
  const session={id:'cs_test_1',client_reference_id:'order',metadata:{dvn_order_id:'order'},livemode:false,currency:'eur',amount_total:2490,payment_status:'paid',status:'complete',payment_intent:'pi_1',collected_information:{shipping_details:{address:{country:'DE'}}}};
  assert.equal(validateStripe(order,session).paymentId,'pi_1');
  for(const patch of [{amount_total:1},{currency:'usd'},{livemode:true},{id:'other'},{client_reference_id:'other'},{payment_status:'unpaid'},{status:'open'},{collected_information:{shipping_details:{address:{country:'FR'}}}}])assert.throws(()=>validateStripe(order,{...session,...patch}),{code:'payment_verification_failed'});
});
test('PayPal proof rejects wrong merchant, pending capture, partial and duplicate captures',async()=>{
  const {validatePayPal}=await import('../functions/api/checkout/_providers.js');
  const order={id:'order',provider_id:'PP1',total_cents:2490};
  const result={id:'PP1',status:'COMPLETED',purchase_units:[{custom_id:'order',payee:{merchant_id:'merchant'},shipping:{address:{country_code:'DE'}},payments:{captures:[{id:'CAP1',status:'COMPLETED',amount:{currency_code:'EUR',value:'24.90'}}]}}]};
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
  let calls=0;t.mock.method(globalThis,'fetch',async(url,opts)=>{calls++;assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');
    const form=opts.body;let amount=0;for(let i=0;i<3;i++)amount+=Number(form.get(`line_items[${i}][price_data][unit_amount]`));
    assert.equal(amount+Number(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')),o.total_cents);
    assert.equal(form.get('success_url'),site+'/api/payments/return?order='+o.id);assert.equal(opts.headers['Idempotency-Key'],o.id+'-create');
    return Response.json({id:'cs_test_1',url:'https://checkout.stripe.com/c/pay/cs_test_1'});
  });
  await createPayment(env,o);const updated=db.sqlite.prepare('SELECT * FROM shop_orders WHERE id=?').get(o.id);
  await createPayment(env,updated);assert.equal(calls,1);db.sqlite.close();
});
test('duplicate Stripe notifications mark paid once without reserving additional stock',async t=>{
  const {reserve}=await import('../functions/api/checkout/_commerce.js'),{reconcile}=await import('../functions/api/checkout/_providers.js');
  const db=database(),env=activeEnv(db.env),o=await reserve(env,await user(),selection());
  db.sqlite.prepare("UPDATE shop_orders SET provider_id='cs_test_1',status='pending' WHERE id=?").run(o.id);
  const read=()=>db.sqlite.prepare('SELECT * FROM shop_orders WHERE id=?').get(o.id);
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'cs_test_1',client_reference_id:o.id,metadata:{dvn_order_id:o.id},livemode:false,currency:'eur',amount_total:2490,payment_status:'paid',status:'complete',payment_intent:'pi_1',shipping_details:{address:{country:'DE'}}}));
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
    return Response.json({id:'PP1',status:'APPROVED',purchase_units:[{custom_id:o.id,amount:{currency_code:'EUR',value:'24.90'},payee:{merchant_id:'merchant'},shipping:{address:{country_code:'DE'}}}]});
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
