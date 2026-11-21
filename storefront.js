import { createShirtViewer } from './shirt-viewer.js';
import { normalizeCart, cartSubtotal, cartStorageKey } from './store-cart.js';
const $ = (selector,scope=document)=>scope.querySelector(selector);
const $$ = (selector,scope=document)=>[...scope.querySelectorAll(selector)];
const lang=()=>document.documentElement.lang==='en'?'en':'de';
const t=(de,en)=>lang()==='en'?en:de;
const money=cents=>new Intl.NumberFormat(lang()==='en'?'en-DE':'de-DE',{style:'currency',currency:'EUR'}).format(cents/100);
const make=(tag,className='',text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const bag=$('#shopping-bag');
const toast=$('#store-toast');
let toastTimer, catalog, products=[], cart=[], currentProduct, selectedImage=0, activeFilter='all';
let user=window.DVNAuth?.user||null, storageKey=cartStorageKey(user), storageAvailable=true, productInit=false;
let shirtViewer;
let checkoutReady=false, checkoutMethods=[];
const guestKey='dvn-first-drop-guest-bag';
const heart='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 21-8.2-8.2a5.3 5.3 0 0 1 7.5-7.5l.7.7.7-.7a5.3 5.3 0 0 1 7.5 7.5L12 21Z"/></svg>';
function translate(){
  $$('[data-de]').forEach(el=>{el.textContent=el.dataset[lang()];});
  $$('[data-aria-de]').forEach(el=>el.setAttribute('aria-label',el.getAttribute('data-aria-'+lang())));
  $$('.product-card[data-product]').forEach(card=>{
    const product=products.find(p=>p.id===card.dataset.product);
    const price=$('.product-card-info > span',card);
    if(product&&price)price.textContent=money(product.priceCents);
  });
  const code=$('#discount-code');if(code)code.placeholder=t('Rabattcode','Discount code');
  if(currentProduct)renderProductCopy();
  if(products.length){renderCart();renderFavourites();}
}
function notify(de,en){clearTimeout(toastTimer);toast.textContent=t(de,en);toast.hidden=false;toastTimer=setTimeout(()=>{toast.hidden=true;},4500);}
function openDialog(dialog){if(dialog&&!dialog.open)dialog.showModal();}
$$('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
$$('[data-open-bag]').forEach(button=>button.addEventListener('click',()=>{renderCart();openDialog(bag);}));
// Essential cart data stays separate for each verified account. A guest bag is
// limited to this tab and is never silently attached to a signed-in identity.
function restoreCart(){
  try{const raw=(storageKey?localStorage:sessionStorage).getItem(storageKey||guestKey);cart=normalizeCart(JSON.parse(raw||'[]'),products);}
  catch{cart=[];storageAvailable=false;}
}
function saveCart(){
  cart=normalizeCart(cart,products);
  try{(storageKey?localStorage:sessionStorage).setItem(storageKey||guestKey,JSON.stringify(cart));storageAvailable=true;}catch{storageAvailable=false;}
  renderCart();
}
function switchAccount(next){
  const key=cartStorageKey(next);user=next;
  if(key!==storageKey){storageKey=key;restoreCart();if(bag?.open)bag.close();}
  renderCart();if(document.body.dataset.page==='checkout')checkCheckoutReadiness();
}
function cartLine(line){
  const p=products.find(p=>p.id===line.productId);if(!p)return null;
  const row=make('div','bag-line');
  const photo=make('a');photo.href='/products/'+p.slug;
  const img=make('img');img.src=p.image;img.alt=p.name;img.width=92;img.height=92;photo.append(img);
  const info=make('div');const top=make('div','bag-line-top');const title=make('h3');const link=make('a','',p.name);link.href=photo.href;title.append(link);top.append(title,make('strong','',money(p.priceCents*line.quantity)));
  const detail=make('p','line-size',t('Größe','Size')+' '+line.size+' · '+p.color[lang()]);
  const controls=make('div','line-controls');
  for(const [label,delta] of [['−',-1],['+',1]]){
    const b=make('button','',label);b.type='button';b.setAttribute('aria-label',(delta<0?t('Menge verringern','Decrease quantity'):t('Menge erhöhen','Increase quantity'))+' – '+p.name);
    b.disabled=delta>0&&cart.reduce((s,l)=>s+l.quantity,0)>=99;
    b.addEventListener('click',()=>{line.quantity+=delta;if(line.quantity<1)cart=cart.filter(l=>l!==line);saveCart();});
    controls.append(b);if(delta<0)controls.append(make('span','',String(line.quantity)));
  }
  const remove=make('button','remove-line',t('Entfernen','Remove'));remove.type='button';remove.setAttribute('aria-label',t('Entfernen','Remove')+' – '+p.name);remove.addEventListener('click',()=>{cart=cart.filter(l=>l!==line);saveCart();});controls.append(remove);
  info.append(top,detail,controls);row.append(photo,info);return row;
}
function renderCart(){
  const count=cart.reduce((s,l)=>s+l.quantity,0);
  $$('[data-bag-count]').forEach(el=>el.textContent=String(count));
  $$('[data-bag-total]').forEach(el=>el.textContent=money(cartSubtotal(cart,products)));
  const shipping=count&&catalog?.shipping.confirmed?catalog.shipping.priceCents:0;
  $$('[data-shipping-total]').forEach(el=>el.textContent=money(shipping));
  $$('[data-order-total]').forEach(el=>el.textContent=money(cartSubtotal(cart,products)+shipping));
  for(const container of [$('#bag-lines'),$('#checkout-lines')].filter(Boolean)){
    container.replaceChildren();
    if(!cart.length){const empty=make('div','empty-message');empty.append(make('p','',t('Dein Warenkorb ist leer.','Your bag is empty.')));const a=make('a','text-button',t('Kollektion entdecken','Explore collection'));a.href='/shop#collection';empty.append(a);container.append(empty);}
    else for(const line of cart){const row=cartLine(line);if(row)container.append(row);}
  }
  const button=$('#bag-checkout');if(button){button.hidden=!count;}
  const note=$('.bag-storage-note');if(note)note.textContent=storageAvailable?t('Deine Auswahl bleibt in diesem Browser.','Your selection stays in this browser.'):t('Deine Auswahl bleibt nur bis zum Schließen dieser Seite erhalten.','Your selection will last until this page is closed.');
  const pay=$('#checkout-pay');if(pay)pay.disabled=!checkoutReady||!count;
}
function addItem(showBag=true){
  const selected=$('input[name="size"]:checked');
  const error=$('#product-error');
  if(!selected){error.textContent=t('Bitte wähle zuerst deine Größe.','Please select a size first.');error.hidden=false;$('#product-sizes input')?.focus();return false;}
  const quantity=Number($('#product-quantity').value);
  if(!Number.isInteger(quantity)||quantity<1||quantity>99){error.textContent=t('Wähle eine Menge zwischen 1 und 99.','Choose a quantity between 1 and 99.');error.hidden=false;return false;}
  if(cart.reduce((s,l)=>s+l.quantity,0)+quantity>99){error.textContent=t('Dein Warenkorb kann höchstens 99 Artikel enthalten.','Your bag can contain up to 99 items.');error.hidden=false;return false;}
  error.hidden=true;const found=cart.find(l=>l.productId===currentProduct.id&&l.size===selected.value);
  if(found)found.quantity+=quantity;else cart.push({productId:currentProduct.id,size:selected.value,quantity});
  saveCart();if(showBag)openDialog(bag);return true;
}
// Only the optional favourites feature persists after consent. There are no
// analytics, marketing scripts or third-party payment SDKs loaded in preview.
let consent=null;try{const saved=JSON.parse(localStorage.getItem('dvn-consent-v1')||'null');if(saved?.version===1&&typeof saved.preferences==='boolean')consent=saved;}catch{}
let favourites=new Set();
if(consent?.preferences){try{const f=JSON.parse(localStorage.getItem('dvn-favourites-v1')||'[]');if(Array.isArray(f))favourites=new Set(f.filter(v=>typeof v==='string').slice(0,20));}catch{}}
const consentDialog=$('#cookie-dialog');
function openPreferences(){if(consentDialog){$('#consent-preferences').checked=Boolean(consent?.preferences);openDialog(consentDialog);}}
$$('[data-cookie-open]').forEach(button=>button.addEventListener('click',openPreferences));
$$('[data-consent]').forEach(button=>button.addEventListener('click',()=>{
  const choice=button.dataset.consent;
  consent={version:1,preferences:choice==='all'||(choice==='save'&&$('#consent-preferences').checked)};
  try{localStorage.setItem('dvn-consent-v1',JSON.stringify(consent));if(consent.preferences)localStorage.setItem('dvn-favourites-v1',JSON.stringify([...favourites]));else localStorage.removeItem('dvn-favourites-v1');}catch{}
  $('#cookie-banner').hidden=true;consentDialog.close();
}));
if(!consent&&$('#cookie-banner'))$('#cookie-banner').hidden=false;
function toggleFavourite(id){
  if(!products.some(p=>p.id===id))return;
  if(favourites.has(id))favourites.delete(id);else favourites.add(id);
  if(consent?.preferences){try{localStorage.setItem('dvn-favourites-v1',JSON.stringify([...favourites]));}catch{}}
  else if(favourites.has(id))notify('Für diesen Besuch gemerkt. Dauerhaft speichern kannst du es in den Cookie-Einstellungen.','Saved for this visit. Enable preferences in cookie settings to keep favourites.');
  renderFavourites();applyFilter();
}
function renderFavourites(){
  $$('[data-favourite]').forEach(button=>{const saved=favourites.has(button.dataset.favourite);button.setAttribute('aria-pressed',String(saved));button.setAttribute('aria-label',saved?t('Aus Favoriten entfernen','Remove favourite'):t('Shirt merken','Save tee'));});
  const p=$('#product-favourite');if(p&&currentProduct){const saved=favourites.has(currentProduct.id);p.setAttribute('aria-pressed',String(saved));$('span',p).textContent=saved?t('Gemerkt','Saved'):t('Zu den Favoriten','Save to favourites');}
}
function bindFavourites(scope=document){$$('[data-favourite]',scope).forEach(button=>{if(button.dataset.bound)return;button.dataset.bound='true';button.addEventListener('click',()=>toggleFavourite(button.dataset.favourite));});}
function applyFilter(){
  let visible=0;$$('#products-grid .product-card').forEach(card=>{const show=activeFilter==='all'||(activeFilter==='saved'?favourites.has(card.dataset.product):activeFilter===card.dataset.family);card.hidden=!show;if(show)visible++;});
  const empty=$('#collection-empty');if(empty)empty.hidden=visible>0;
  $$('[data-filter]').forEach(b=>{const active=b.dataset.filter===activeFilter;b.classList.toggle('filter-active',active);b.setAttribute('aria-pressed',String(active));});
}
$$('[data-filter]').forEach(button=>button.addEventListener('click',()=>{activeFilter=button.dataset.filter;applyFilter();}));
function productCard(p){
  const article=make('article','product-card');const media=make('div','product-card-media');const a=make('a');a.href='/products/'+p.slug;const img=make('img');img.src=p.image;img.alt=p.name;img.loading='lazy';img.width=1000;img.height=1000;a.append(img);
  const b=make('button','save-product');b.type='button';b.dataset.favourite=p.id;b.innerHTML=heart;b.setAttribute('aria-pressed','false');media.append(a,b);
  const info=make('a','product-card-info');info.href=a.href;info.append(make('h3','',p.name),make('span','',money(p.priceCents)),make('p','',p.color[lang()]));article.append(media,info);return article;
}
function productImages(){
  const images=currentProduct.images.map((src,i)=>({src,label:i===0?t('Produktansicht','Product view'):t('Rückansicht','Back view'),isModel:false}));
  images.splice(1,0,{src:currentProduct.image,label:t('3D-Ansicht','3D view'),is3D:true});
  if(currentProduct.id!=='define-your-vision')images.push({src:'/assets/lookbook/'+currentProduct.id+'.jpg',label:t('KI-generierte Styling-Visualisierung','AI-generated styling visualisation'),isModel:true});
  return images;
}
function showProductImage(index){
  const images=productImages();selectedImage=(index+images.length)%images.length;const item=images[selectedImage];
  $('#zoom-photo').hidden=Boolean(item.is3D);
  if(item.is3D){
    shirtViewer ||= createShirtViewer($('#product-3d-view'),currentProduct);
    shirtViewer.show();$('#product-image-caption').textContent=t('360° · Interaktive Shirtansicht','360° · Interactive tee view');
  }else{
    shirtViewer?.hide();const main=$('#product-main-image');main.src=item.src;main.alt=currentProduct.name+' – '+item.label;main.classList.toggle('is-lookbook',item.isModel);$('#product-image-caption').textContent=item.isModel?item.label:t('Original-Produktfoto','Original product photo');
  }
  $('#gallery-position').textContent=(selectedImage+1)+' / '+images.length;
  $$('#product-thumbnails button').forEach((button,i)=>{button.setAttribute('aria-pressed',String(i===selectedImage));button.setAttribute('aria-label',images[i].label);});
}
function renderProductCopy(){
  if(!currentProduct)return;
  document.title=currentProduct.name+' | DVN CLOTHING';
  $('#product-title').textContent=currentProduct.name;$('#breadcrumb-product').textContent=currentProduct.name;
  $('#product-price').textContent=money(currentProduct.priceCents);$('#product-color').textContent=currentProduct.color[lang()];
  $('#product-description').textContent=currentProduct.description[lang()];$('#product-detail-color').textContent=t('Gezeigte Farbe: ','Shown colour: ')+currentProduct.color[lang()];
  if(productInit)showProductImage(selectedImage);
  const related=$('#related-products');if(related){related.replaceChildren(...products.filter(p=>p.id!==currentProduct.id).map(productCard));bindFavourites(related);}
}
function initializeProduct(){
  const segments=location.pathname.split('/').filter(Boolean);
  const id=segments[0]==='products'?segments[1]:new URLSearchParams(location.search).get('id');
  currentProduct=products.find(p=>p.slug===id);
  if(!currentProduct){const message=$('#product-loading');message.replaceChildren(make('p','',t('Dieses Shirt wurde nicht gefunden.','This tee could not be found.')));const back=make('a','button-dark',t('Zur Kollektion','Back to collection'));back.href='/shop#collection';message.append(back);return;}
  const choices=$('#product-sizes');for(const size of currentProduct.sizes){const label=make('label');const input=make('input');input.type='radio';input.name='size';input.value=size;input.required=true;input.addEventListener('change',()=>{$('#selected-size').textContent='· '+size;$('#product-error').hidden=true;});label.append(input,make('span','',size));choices.append(label);}
  const thumbs=$('#product-thumbnails');productImages().forEach((item,i)=>{const button=make('button');button.type='button';button.setAttribute('aria-label',item.label);button.setAttribute('aria-pressed',String(i===0));const img=make('img');img.src=item.src;img.alt='';img.width=80;img.height=86;button.append(img);if(item.is3D){button.classList.add('gallery-3d-thumb');button.append(make('span','','3D'));}button.addEventListener('click',()=>showProductImage(i));thumbs.append(button);});
  $$('[data-gallery-step]').forEach(button=>button.addEventListener('click',()=>showProductImage(selectedImage+Number(button.dataset.galleryStep))));
  productInit=true;renderProductCopy();$('#product-loading').hidden=true;$('#product-layout').hidden=false;$('#related-section').hidden=false;
  $('#product-form').addEventListener('submit',e=>{e.preventDefault();addItem();});
  $$('[data-quantity]').forEach(button=>button.addEventListener('click',()=>{const input=$('#product-quantity');input.value=String(Math.max(1,Math.min(99,(Number(input.value)||1)+Number(button.dataset.quantity))));}));
  $('#product-favourite').addEventListener('click',()=>toggleFavourite(currentProduct.id));
  $('#size-guide-trigger').addEventListener('click',()=>openDialog($('#size-dialog')));
  $('#zoom-photo').addEventListener('click',()=>{const img=$('#zoomed-image');img.src=$('#product-main-image').src;img.alt=$('#product-main-image').alt;openDialog($('#image-dialog'));});
  $('#product-paypal').addEventListener('click',()=>{if(addItem(false))location.assign('/checkout?method=paypal');});
}
async function checkCheckoutReadiness(){
  checkoutReady=false;checkoutMethods=[];
  const summary=$('#checkout-account-summary');
  if(summary)summary.textContent=user?.email?t('Angemeldet als ','Signed in as ')+user.email:t('Deine Kontaktdaten werden im sicheren Bezahlvorgang abgefragt.','Your contact details will be requested in the secure payment flow.');
  if(user?.id){try{const r=await fetch('/api/checkout/config',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});const d=await r.json();if(r.ok&&d.ready===true&&Array.isArray(d.methods)){checkoutReady=true;checkoutMethods=d.methods.filter(m=>['paypal','card'].includes(m));}}catch{}}
  renderCart();
}
async function checkout(method){
  if(!cart.length){notify('Dein Warenkorb ist leer.','Your bag is empty.');return;}
  if(!checkoutReady||!checkoutMethods.includes(method)){notify('Zahlungen sind noch nicht freigeschaltet. Deine Auswahl bleibt im Warenkorb.','Payments are not open yet. Your selection stays in your bag.');return;}
  if(!await window.DVNAuth?.requireLogin?.())return;
  const expectedKey=storageKey;
  try{
    const response=await fetch('/api/checkout/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,items:cart.map(l=>({...l}))}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(expectedKey!==storageKey)return;
    if(!response.ok)throw new Error('checkout');
    const url=new URL(result.url);const allowed=['checkout.stripe.com','www.paypal.com','www.sandbox.paypal.com'];
    if(url.protocol!=='https:'||!allowed.includes(url.hostname))throw new Error('destination');
    location.assign(url.href);
  }catch{notify('Der Checkout ist gerade nicht verfügbar. Bitte versuche es später erneut.','Checkout is temporarily unavailable. Please try again later.');}
}
$('#checkout-signin')?.addEventListener('click',()=>{$('[data-google-auth]')?.click();});
$$('[data-checkout-method]').forEach(b=>b.addEventListener('click',()=>checkout(b.dataset.checkoutMethod)));
$('#checkout-pay')?.addEventListener('click',()=>checkout('card'));
$('#discount-form')?.addEventListener('submit',e=>{e.preventDefault();const m=$('#discount-message');m.hidden=false;m.textContent=t('Rabattcodes lassen sich prüfen, sobald der Verkauf geöffnet ist. Aktuell wurde kein Rabatt angewendet.','Discount codes can be checked when sales open. No discount has been applied yet.');});
$$('[data-preview-logout]').forEach(button=>button.addEventListener('click',async()=>{
  button.disabled=true;
  try{const r=await fetch('/api/preview/logout',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error();location.assign('/');}
  catch{button.disabled=false;notify('Die Vorschau konnte nicht geschlossen werden. Bitte erneut versuchen.','Could not close the preview. Please try again.');}
}));
document.addEventListener('dvn:authchange',e=>{switchAccount(e.detail?.user||null);});
document.addEventListener('dvn:languagechange',translate);
window.addEventListener('storage',e=>{
  if(storageKey&&e.key===storageKey){restoreCart();renderCart();}
  if(e.key==='dvn-consent-v1'){try{const c=JSON.parse(e.newValue||'null');consent=c?.version===1?c:null;}catch{consent=null;}if(!consent?.preferences){try{localStorage.removeItem('dvn-favourites-v1');}catch{}}}
});
translate();
try{
  const response=await fetch('/catalog.json',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(response.status===401){location.replace('/?next='+encodeURIComponent(location.pathname));}
  else {
    if(!response.ok)throw new Error('catalog');catalog=await response.json();if(!Array.isArray(catalog.products))throw new Error('catalog');products=catalog.products;
    user=window.DVNAuth?.user||null;storageKey=cartStorageKey(user);restoreCart();
    if(document.body.dataset.page==='product')initializeProduct();
    if(document.body.dataset.page==='checkout')await checkCheckoutReadiness();
    bindFavourites();translate();applyFilter();
  }
}catch{notify('Die Kollektion konnte nicht geladen werden. Bitte lade die Seite erneut.','The collection could not be loaded. Please reload the page.');const loading=$('#product-loading');if(loading)loading.textContent=t('Die Produktdaten sind gerade nicht erreichbar. Bitte lade die Seite erneut.','Product details are unavailable. Please reload the page.');}
const logo=$('[data-logo-3d]');
if(logo){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');let pending=false;
  const paint=()=>{pending=false;if(reduced.matches)return;const r=logo.parentElement.getBoundingClientRect();const p=Math.max(-1,Math.min(1,(innerHeight/2-r.top)/innerHeight));logo.style.transform=`rotateX(${-8+p*12}deg) rotateY(${-20+p*55}deg)`;};
  const queue=()=>{if(!pending){pending=true;requestAnimationFrame(paint);}};
  addEventListener('scroll',queue,{passive:true});reduced.addEventListener('change',()=>{if(reduced.matches)logo.style.transform='none';else queue();});queue();
}
