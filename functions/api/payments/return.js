import { noStore } from '../auth/_lib.js';
// Provider callbacks do not bypass the shop gate or authenticate a customer.
// An ordinary same-origin link resumes navigation; the signed cookies still apply.
export function onRequestGet({request}) {
  const params=new URL(request.url).searchParams,id=params.get('order');
  if(!/^dvn_[a-f0-9]{32}$/.test(id||''))return noStore(new Response('Ungültige Bestellkennung',{status:400}));
  const action=params.get('cancel')==='1'?'cancel':'complete';
  const html=`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zahlungsstatus · DVN CLOTHING</title><link rel="stylesheet" href="/styles.css"><body><main style="max-width:560px;margin:15vh auto;padding:24px"><h1>Zurück zu DVN CLOTHING</h1><p>Der Zahlungsstatus wird erst nach der Prüfung durch den Zahlungsanbieter bestätigt.</p><p><a href="/checkout?order=${id}&amp;action=${action}">Bestellstatus öffnen</a></p><p>Falls dein Zugang abgelaufen ist, melde dich erneut an. Die Bestellung bleibt deinem Konto zugeordnet.</p></main></body></html>`;
  return noStore(new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'none'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}}));
}
