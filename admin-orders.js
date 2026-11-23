(() => {
  const $=s=>document.querySelector(s),section=$('#admin-content'),list=$('#admin-orders'),pending=$('#admin-pending');
  let epoch=0,busy=false,next=null,testKey=null,orders=[],catalog=[],inventory=[];
  const labels={overview:'Startseite',orders:'Bestellungen',products:'Produkte',customers:'Kunden',analytics:'Statistiken',settings:'Einstellungen'};
  function view(key){if(!labels[key])key='overview';document.querySelectorAll('[data-admin-panel]').forEach(p=>p.hidden=p.dataset.adminPanel!==key);document.querySelectorAll('[data-admin-view]').forEach(b=>{if(b.dataset.adminView===key)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$('#admin-title').textContent=labels[key];history.replaceState(null,'','#'+key);}
  document.querySelectorAll('[data-admin-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.adminView)));
  view(location.hash.slice(1));
  const money=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n/100);
  const messages={admin_locked:'Bitte das Admin-Passwort eingeben.',too_many_attempts:'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.',invalid_password:'Passwort nicht korrekt.',unauthenticated:'Bitte mit account@dvnclothing.com anmelden.',forbidden:'Nur account@dvnclothing.com hat Zugriff auf dieses Dashboard.',test_rate_limited:'Bitte eine Minute zwischen Testmeldungen warten.',notification_not_configured:'Der Discord-Zugang ist noch nicht eingerichtet.'};
  const node=(tag,text,parent,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;parent.append(e);return e;};
  async function api(body,before){
    const r=await fetch('/api/admin/orders'+(before?'?before='+encodeURIComponent(before):''),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const data=await r.json();if(!r.ok)throw Error(messages[data.error]||'Der Vorgang ist gerade nicht verfügbar. Bitte erneut versuchen.');return data;
  }
  function renderMetrics(m,target=$('#admin-metrics')){target.replaceChildren();if(!m)return;for(const [label,value] of [['Umsatz (Live)',money(m.salesCents)],['Bezahlte Bestellungen',String(m.orders)],['Verkaufte Shirts',String(m.units)],['Verfügbarer Bestand',String(m.stock)]]){const card=node('article','',target,'admin-metric');node('span',label,card);node('strong',value,card);}const chart=node('section','',target,'admin-chart');node('h2','Umsatz der letzten 7 Tage',chart);const bars=node('div','',chart,'admin-bars');const max=Math.max(1,...m.days.map(d=>d.cents));for(const d of m.days){const bar=node('div','',bars,'admin-bar');const fill=node('span','',bar);fill.style.height=Math.max(2,Math.round(d.cents/max*100))+'%';bar.title=d.date+' · '+money(d.cents);node('small',d.date.slice(5),bar);}}
  function clear(){epoch++;next=null;list.replaceChildren();pending.replaceChildren();orders=[];inventory=[];$('#admin-products').replaceChildren();$('#admin-customers').replaceChildren();$('#admin-metrics').replaceChildren();$('#admin-analytics').replaceChildren();section.hidden=true;$('#admin-password-form').hidden=true;$('#admin-feedback').textContent='';}
  async function load(append=false){
    const version=epoch;
    try{
      const data=await api(null,append?next:null);if(version!==epoch)return;
      section.hidden=false;$('#admin-login').hidden=true;$('#admin-password-form').hidden=true;renderMetrics(data.metrics);renderMetrics(data.metrics,$('#admin-analytics'));$('#admin-status').textContent='Geschützter Betreiberbereich · account@dvnclothing.com';$('#admin-updated').textContent='Zuletzt aktualisiert · '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});$('#admin-webhook-status').textContent=data.webhookConfigured?'Discord ist verbunden.':'Discord ist noch nicht eingerichtet.';inventory=data.inventory||[];orders=append?[...orders,...data.orders]:data.orders;renderCustomers();renderProducts();
      if(!append)list.replaceChildren();pending.replaceChildren();
      if(!data.webhookConfigured)node('p','Discord ist noch nicht eingerichtet.',pending,'admin-alert');
      for(const job of data.pending){const row=node('div','',pending,'admin-alert');node('p',job.id+' · '+(job.last_error||job.status),row);const btn=node('button','Zustellung erneut versuchen',row);btn.type='button';btn.addEventListener('click',()=>action({action:'retry',id:job.id}));}
      if(!append&&!data.orders.length)empty(list,'Hier erscheinen deine Bestellungen.','Sobald eine Bestellung eingeht, findest du hier Artikel, Zahlungsstatus und Lieferadresse.');
      for(const o of data.orders){
        const card=node('article','',list,'admin-card');card.dataset.search=(o.id+' '+o.email).toLowerCase();node('h2',(o.test?'TEST · ':'')+o.id,card);
        node('p',({paid:'Bezahlt',cancelled:'Abgebrochen',creating:'Wird vorbereitet',pending:'Zahlung ausstehend',capturing:'Zahlung wird geprüft'}[o.status]||o.status)+' · '+new Date(o.createdAt*1000).toLocaleString('de-DE')+' · Discord: '+(o.notificationStatus||'noch nicht fällig'),card);
        const grid=node('div','',card,'admin-grid'),items=node('div','',grid),contact=node('div','',grid);
        node('h3','Artikel',items);for(const l of o.items)node('p',`${l.quantity} × ${l.productId} · ${l.size} · ${money(l.unitPriceCents*l.quantity)}`,items);
        const totals=node('dl','',items);for(const [label,amount] of [['Artikel',o.subtotalCents],['Rabatt',-o.discountCents],['Versand',o.shippingCents],['Gesamt',o.totalCents]]){node('dt',label,totals);node('dd',money(amount),totals);}
        node('h3','Kontakt & Lieferung',contact);node('p',o.email,contact);if(o.phone)node('p','Telefon: '+o.phone,contact);const s=o.shipping||{};
        node('pre',[s.name,s.line1,s.line2,[s.postalCode,s.city].filter(Boolean).join(' '),s.region,s.country].filter(Boolean).join('\n')||'Noch keine bestätigte Lieferadresse.',contact);
        node('p',(o.method==='paypal'?'PayPal':'Karte über Stripe')+(o.paymentId?' · '+o.paymentId:''),contact);
      }
      next=data.next;$('#admin-more').hidden=!next;filterOrders();
    }catch(e){if(version!==epoch)return;clear();if([messages.unauthenticated,messages.forbidden,messages.admin_locked].includes(e.message)){location.reload();return;}$('#admin-password-form').hidden=e.message!==messages.admin_locked;$('#admin-login').hidden=e.message===messages.admin_locked;$('#admin-status').textContent=e.message;}
  }
  function empty(target,title,description){const el=node('div','',target,'admin-empty');node('strong',title,el);node('p',description,el);}
  function table(target,headers){target.replaceChildren();const t=node('table','',target,'admin-table'),head=node('tr','',node('thead','',t));headers.forEach(h=>node('th',h,head));return node('tbody','',t);}
  function renderCustomers(){const target=$('#admin-customers'),q=$('#admin-customer-search').value.trim().toLowerCase(),customers=new Map();for(const o of orders){const key=o.email.toLowerCase(),c=customers.get(key)||{email:o.email,orders:0,total:0};c.orders++;if(o.status==='paid'&&!o.test)c.total+=o.totalCents;customers.set(key,c);}const rows=[...customers.values()].filter(c=>c.email.toLowerCase().includes(q));if(!rows.length){target.replaceChildren();empty(target,'Noch keine passenden Kunden','Kunden erscheinen hier mit ihrer ersten Bestellung.');return;}const body=table(target,['Kunde','Geladene Bestellungen','Bezahlt (Live)']);rows.forEach(c=>{const row=node('tr','',body);[c.email,c.orders,money(c.total)].forEach(v=>node('td',String(v),row));});}
  function renderProducts(){const target=$('#admin-products');if(!inventory.length){target.replaceChildren();empty(target,'Bestand wird geladen','Bitte aktualisiere das Dashboard.');return;}const body=table(target,['Produkt','Preis','S','M','L']);const ids=[...new Set(inventory.map(i=>i.product_id))];ids.forEach(id=>{const product=catalog.find(p=>p.id===id),row=node('tr','',body),cell=node('td','',row),wrap=node('div','',cell,'admin-product-cell');if(product?.image){const img=document.createElement('img');img.src=product.image;img.alt='';img.className='admin-product-photo';wrap.append(img);}node('span',product?.name||id,wrap,'admin-product-name');node('td',product?money(product.priceCents):'—',row);['S','M','L'].forEach(size=>node('td',String(inventory.find(i=>i.product_id===id&&i.size===size)?.available??0),row));});}
  function filterOrders(){const q=$('#admin-order-search').value.trim().toLowerCase();list.querySelectorAll('[data-search]').forEach(card=>card.hidden=!card.dataset.search.includes(q));}
  $('#admin-order-search').addEventListener('input',filterOrders);$('#admin-customer-search').addEventListener('input',renderCustomers);
  fetch('/catalog.json',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{catalog=data?.products||[];if(!section.hidden)renderProducts();}).catch(()=>{});
  async function action(body){
    if(busy)return;busy=true;const version=epoch;section.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{const r=await api(body);if(version!==epoch)return;if(body.action==='simulate'&&r.sent)testKey=null;
      $('#admin-feedback').textContent=r.sent?'Discord hat die Meldung bestätigt.':'Die Meldung ist gespeichert. Die Zustellung wird beim nächsten Versuch erneut geprüft.';await load();
    }catch(e){if(version===epoch)$('#admin-feedback').textContent=e.message;}
    finally{busy=false;section.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  $('#admin-password-form').addEventListener('submit',async e=>{e.preventDefault();const field=$('#admin-password');try{const r=await fetch('/api/admin/access',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:field.value})});const data=await r.json();field.value='';if(!r.ok)throw Error(messages[data.error]||'Zugang derzeit nicht möglich.');await load();}catch(error){$('#admin-status').textContent=error.message;}});
  $('#admin-test').addEventListener('click',()=>{testKey ||= crypto.randomUUID();action({action:'simulate',key:testKey});});
  $('#admin-refresh').addEventListener('click',()=>load());$('#admin-more').addEventListener('click',()=>load(true));
  $('#admin-login').addEventListener('click',async()=>{if(await window.DVNAuth?.requireLogin())load();});
  document.addEventListener('dvn:authchange',event=>{clear();if(event.detail?.user?.email?.toLowerCase()==='account@dvnclothing.com')load();else location.reload();});
  window.addEventListener('pageshow',event=>{if(event.persisted){clear();location.reload();}});
  window.addEventListener('pagehide',clear);load();
})();
