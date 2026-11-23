import { analyticsDb } from '../analytics.js';
import { requireAdminAccess } from './_access.js';
import { reply,requestOrigin,CheckoutError } from '../checkout/_lib.js';
export function berlinDayStart(now){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now*1000)).map(p=>[p.type,p.value]));
  const nominal=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day));let candidate=nominal;
  for(let i=0;i<3;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(candidate)).map(p=>[p.type,p.value]));const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);candidate-=represented-nominal;}
  return Math.floor(candidate/1000);
}
export async function onRequestGet({request,env}){
  const invalid=requestOrigin(request,false);if(invalid)return invalid;
  try{
    await requireAdminAccess(request,env);const db=await analyticsDb(env),now=Math.floor(Date.now()/1000),from=now-7*86400;
    const summary=await db.prepare('SELECT COUNT(*) views,COUNT(DISTINCT session_id) visits,MIN(at) since FROM site_views WHERE at>=?').bind(from).first();
    const live=await db.prepare('SELECT COUNT(*) active FROM site_visits WHERE last_seen>=?').bind(now-120).first();
    const pages=await db.prepare('SELECT path,COUNT(*) views FROM site_views WHERE at>=? GROUP BY path ORDER BY views DESC LIMIT 12').bind(from).all();
    const devices=await db.prepare('SELECT device,COUNT(DISTINCT session_id) visits FROM site_views WHERE at>=? GROUP BY device').bind(from).all();
    const hourly=await db.prepare("SELECT strftime('%Y-%m-%dT%H:00:00Z',at,'unixepoch') hour,COUNT(*) views,COUNT(DISTINCT session_id) visits FROM site_views WHERE at>=? GROUP BY hour ORDER BY hour").bind(now-24*3600).all();
    const current=await db.prepare('SELECT path,COUNT(*) active FROM site_visits WHERE last_seen>=? GROUP BY path ORDER BY active DESC LIMIT 12').bind(now-120).all();
    const start=berlinDayStart(now);
    const activity=await db.prepare('SELECT bucket,COUNT(*) active FROM site_activity WHERE bucket>=? GROUP BY bucket ORDER BY bucket').bind(Math.min(start,now-3600)).all();
    const countries=await db.prepare('SELECT country,COUNT(DISTINCT session_id) visits FROM site_activity WHERE bucket>=? GROUP BY country ORDER BY visits DESC').bind(start).all();
    const today=Array.from({length:Math.floor((now-start)/300)+1},(_,i)=>{const at=start+i*300;return {at,active:activity.results.length&&at>=activity.results[0].bucket?(activity.results.find(r=>r.bucket===at)?.active||0):null};});
    const recent=Array.from({length:12},(_,i)=>{const at=(Math.floor(now/300)-11+i)*300;return {at,active:activity.results.length&&at>=activity.results[0].bucket?(activity.results.find(r=>r.bucket===at)?.active||0):null};});
    const hours=Array.from({length:24},(_,i)=>{const hour=new Date((Math.floor(now/3600)-23+i)*3600000).toISOString().replace('.000Z','Z');const row=hourly.results.find(r=>r.hour===hour);return {hour,views:row?.views||0,visits:row?.visits||0};});
    return reply({at:now,summary,active:live.active,pages:pages.results,devices:devices.results,hours,today,recent,countries:countries.results,current:current.results});
  }catch(e){return reply({error:e instanceof CheckoutError?e.code:'analytics_unavailable'},e instanceof CheckoutError?e.status:503);}
}
