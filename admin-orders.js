(() => {
  const $=s=>document.querySelector(s),section=$('#admin-content'),list=$('#admin-orders'),pending=$('#admin-pending');
  let epoch=0,busy=false,next=null,testKey=null;
  const money=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n/100);
  const messages={unauthenticated:'Bitte mit deinem Betreiberkonto anmelden.',forbidden:'Dieses Konto hat keinen Zugriff auf Bestellungen.',test_rate_limited:'Bitte eine Minute zwischen Testmeldungen warten.',notification_not_configured:'Der Discord-Zugang ist noch nicht eingerichtet.'};
  const node=(tag,text,parent,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;parent.append(e);return e;};
  async function api(body,before){
    const r=await fetch('/api/admin/orders'+(before?'?before='+encodeURIComponent(before):''),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const data=await r.json();if(!r.ok)throw Error(messages[data.error]||'Der Vorgang ist gerade nicht verfügbar. Bitte erneut versuchen.');return data;
  }
  function clear(){epoch++;next=null;list.replaceChildren();pending.replaceChildren();section.hidden=true;$('#admin-feedback').textContent='';}
  async function load(append=false){
    const version=epoch;
    try{
      const data=await api(null,append?next:null);if(version!==epoch)return;
      section.hidden=false;$('#admin-login').hidden=true;$('#admin-status').textContent='Nur für dein freigeschaltetes Betreiberkonto. Kunden sehen diese Daten nicht.';
      if(!append)list.replaceChildren();pending.replaceChildren();
      if(!data.webhookConfigured)node('p','Discord ist noch nicht eingerichtet.',pending,'admin-alert');
      for(const job of data.pending){const row=node('div','',pending,'admin-alert');node('p',job.id+' · '+(job.last_error||job.status),row);const btn=node('button','Zustellung erneut versuchen',row);btn.type='button';btn.addEventListener('click',()=>action({action:'retry',id:job.id}));}
      if(!append&&!data.orders.length)node('p','Noch keine Bestellungen. Mit dem Testknopf kannst du die Discord-Meldung prüfen.',list);
      for(const o of data.orders){
        const card=node('article','',list,'admin-card');node('h2',(o.test?'TEST · ':'')+o.id,card);
        node('p',({paid:'Bezahlt',cancelled:'Abgebrochen',creating:'Wird vorbereitet',pending:'Zahlung ausstehend',capturing:'Zahlung wird geprüft'}[o.status]||o.status)+' · '+new Date(o.createdAt*1000).toLocaleString('de-DE')+' · Discord: '+(o.notificationStatus||'noch nicht fällig'),card);
        const grid=node('div','',card,'admin-grid'),items=node('div','',grid),contact=node('div','',grid);
        node('h3','Artikel',items);for(const l of o.items)node('p',`${l.quantity} × ${l.productId} · ${l.size} · ${money(l.unitPriceCents*l.quantity)}`,items);
        const totals=node('dl','',items);for(const [label,amount] of [['Artikel',o.subtotalCents],['Rabatt',-o.discountCents],['Versand',o.shippingCents],['Gesamt',o.totalCents]]){node('dt',label,totals);node('dd',money(amount),totals);}
        node('h3','Kontakt & Lieferung',contact);node('p',o.email,contact);const s=o.shipping||{};
        node('pre',[s.name,s.line1,s.line2,[s.postalCode,s.city].filter(Boolean).join(' '),s.region,s.country].filter(Boolean).join('\n')||'Noch keine bestätigte Lieferadresse.',contact);
        node('p',(o.method==='paypal'?'PayPal':'Karte über Stripe')+(o.paymentId?' · '+o.paymentId:''),contact);
      }
      next=data.next;$('#admin-more').hidden=!next;
    }catch(e){if(version!==epoch)return;clear();$('#admin-login').hidden=false;$('#admin-status').textContent=e.message;}
  }
  async function action(body){
    if(busy)return;busy=true;const version=epoch;section.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{const r=await api(body);if(version!==epoch)return;if(body.action==='simulate'&&r.sent)testKey=null;
      $('#admin-feedback').textContent=r.sent?'Discord hat die Meldung bestätigt.':'Die Meldung ist gespeichert. Die Zustellung wird beim nächsten Versuch erneut geprüft.';await load();
    }catch(e){if(version===epoch)$('#admin-feedback').textContent=e.message;}
    finally{busy=false;section.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  $('#admin-test').addEventListener('click',()=>{testKey ||= crypto.randomUUID();action({action:'simulate',key:testKey});});
  $('#admin-refresh').addEventListener('click',()=>load());$('#admin-more').addEventListener('click',()=>load(true));
  $('#admin-login').addEventListener('click',async()=>{if(await window.DVNAuth?.requireLogin())load();});
  document.addEventListener('dvn:authchange',()=>{clear();load();});
  window.addEventListener('pagehide',clear);load();
})();
