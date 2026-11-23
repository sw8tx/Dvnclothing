(() => {
  if(location.pathname.startsWith('/admin')||navigator.doNotTrack==='1'||navigator.globalPrivacyControl)return;
  const key='dvn-analytics-consent-v1',sessionKey='dvn-analytics-session-v1';let enabled=false,session=null,timer=null,view=crypto.randomUUID(),sent=false;
  function send(){if(!enabled||document.visibilityState!=='visible')return;const kind=sent?'heartbeat':'view';fetch('/api/analytics',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true,session,view,kind,path:['/','/launch','/launch.html','/index.html'].includes(location.pathname)?'/':location.pathname.replace(/\.html$/,'').replace(/\/$/,''),device:innerWidth<640?'mobile':innerWidth<1100?'tablet':'desktop'}),keepalive:true}).then(r=>{if(r.ok)sent=true;}).catch(()=>{});}
  function start(){try{const previous=JSON.parse(sessionStorage.getItem(sessionKey)||'null');session=previous?.expires>Date.now()?previous.id:crypto.randomUUID();sessionStorage.setItem(sessionKey,JSON.stringify({id:session,expires:Date.now()+30*60000}));}catch{session=crypto.randomUUID();}enabled=true;send();clearInterval(timer);timer=setInterval(send,60000);}
  function stop(){enabled=false;clearInterval(timer);try{sessionStorage.removeItem(sessionKey);}catch{}}
  function choose(value){try{localStorage.setItem(key,value?'yes':'no');}catch{}banner.hidden=true;if(value)start();else stop();}
  const banner=document.createElement('aside');banner.className='visitor-consent';banner.setAttribute('aria-label','Besucherstatistik');banner.hidden=true;
  const p=document.createElement('p');p.textContent='Dürfen wir anonyme Nutzungsstatistiken erfassen, um unseren Shop zu verbessern?';banner.append(p);
  for(const [label,value] of [['Erlauben',true],['Ablehnen',false]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>choose(value));banner.append(b);}const link=document.createElement('a');link.href='/privacy.html';link.textContent='Datenschutz';banner.append(link);document.body.append(banner);
  const footer=document.createElement('button');footer.className='visitor-privacy';footer.type='button';footer.textContent='Statistik-Einstellungen';footer.addEventListener('click',()=>{banner.hidden=!banner.hidden;});(document.querySelector('footer')||document.body).append(footer);
  try{const choice=localStorage.getItem(key);if(choice==='yes')start();else if(choice!=='no')banner.hidden=false;}catch{banner.hidden=false;}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)send();});window.addEventListener('pagehide',()=>clearInterval(timer));window.addEventListener('pageshow',e=>{if(e.persisted&&enabled){send();timer=setInterval(send,60000);}});
  window.addEventListener('storage',e=>{if(e.key===key){if(e.newValue==='yes'&&!enabled)start();else if(e.newValue!=='yes')stop();}});
})();
