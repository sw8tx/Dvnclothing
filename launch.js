(() => {
  'use strict';
  let language = 'de';
  try { if (localStorage.getItem('dvn-language') === 'en') language = 'en'; } catch {}
  const form = document.querySelector('#launch-password-form');
  const password = document.querySelector('#preview-password');
  const error = document.querySelector('#launch-error');
  const submit = document.querySelector('#unlock-button');
  const copy = (de,en) => language === 'en' ? en : de;
  let busy = false;
  function translate() {
    document.documentElement.lang = language;
    document.querySelectorAll('[data-de]').forEach(el => { el.textContent = el.dataset[language]; });
    document.querySelectorAll('[data-language]').forEach(el => el.setAttribute('aria-pressed',String(el.dataset.language===language)));
    document.dispatchEvent(new CustomEvent('dvn:languagechange'));
    password.placeholder = copy('Passwort','Password');
    document.querySelector('#password-visibility').setAttribute('aria-label',copy('Passwort anzeigen oder verbergen','Show or hide password'));
  }
  document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click',() => {
    language=button.dataset.language;
    try {localStorage.setItem('dvn-language',language);} catch {}
    translate();
  }));
  window.DVNLocale={t:(key,variables={})=>{const units={day:['Tag','Day'],days:['Tage','Days'],hour:['Stunde','Hour'],hours:['Stunden','Hours'],minute:['Minute','Minute'],minutes:['Minuten','Minutes'],second:['Sekunde','Second'],seconds:['Sekunden','Seconds']};if(key.startsWith('unit.'))return units[key.slice(5)][language==='en'?1:0];return key==='timer.complete'?copy('Launch-Zeitpunkt erreicht','Launch time reached'):copy('Countdown bis ','Countdown to ')+variables.date+': '+variables.remaining;}};
  translate();
  document.querySelector('#password-toggle').addEventListener('click',e => {
    form.hidden=!form.hidden;
    e.currentTarget.setAttribute('aria-expanded',String(!form.hidden));
    if (!form.hidden) password.focus();
  });
  document.querySelector('#password-visibility').addEventListener('click',e => {
    const show=password.type==='password';
    password.type=show?'text':'password';
    e.currentTarget.textContent=show?copy('Verbergen','Hide'):copy('Zeigen','Show');
  });
  form.addEventListener('submit',async e => {
    e.preventDefault();
    if(busy || !form.reportValidity())return;
    busy=true;submit.disabled=true;error.hidden=true;
    submit.textContent=copy('Wird geprüft …','Checking …');
    try {
      const next=new URLSearchParams(location.search).get('next') || '/shop';
      const response=await fetch('/api/preview/unlock',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:password.value,next}),signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      if(!response.ok){
        const message=response.status===401?copy('Das Passwort stimmt nicht. Bitte prüfe deine Eingabe.','That password is incorrect. Please check your entry.') :response.status===429?copy('Zu viele Versuche. Bitte warte kurz und versuche es erneut.','Too many attempts. Please wait a moment and try again.'):copy('Der Zugang ist gerade nicht erreichbar. Bitte versuche es später erneut.','Access is temporarily unavailable. Please try again later.');
        throw new Error(message);
      }
      const redirect=new URL(data.redirect || '/shop',location.origin);
      location.assign(redirect.origin===location.origin?redirect.pathname+redirect.search:'/shop');
    } catch(e) {error.textContent=e.name==='TypeError'||e.name==='TimeoutError'?copy('Bitte prüfe deine Verbindung und versuche es erneut.','Check your connection and try again.'):e.message;error.hidden=false;}
    finally {busy=false;submit.disabled=false;submit.textContent=copy('Shop ansehen','Enter shop');}
  });
  const logo=document.querySelector('[data-logo-3d]');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,px=0,py=0;
  function paint(){frame=0;if(reduced.matches)return;const y=Math.min(1,scrollY/500);logo.style.transform=`rotateX(${-8+py*7+y*16}deg) rotateY(${-16+px*18+y*27}deg)`;}
  function queue(){if(!frame)frame=requestAnimationFrame(paint);}
  document.querySelector('.launch-logo-stage').addEventListener('pointermove',e=>{if(e.pointerType!=='mouse')return;const r=e.currentTarget.getBoundingClientRect();px=(e.clientX-r.left)/r.width-.5;py=(e.clientY-r.top)/r.height-.5;queue();});
  document.querySelector('.launch-logo-stage').addEventListener('pointerleave',()=>{px=py=0;queue();});
  addEventListener('scroll',queue,{passive:true});reduced.addEventListener('change',()=>{if(reduced.matches)logo.style.transform='none';else queue();});queue();
})();
