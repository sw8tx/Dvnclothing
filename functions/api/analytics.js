import { readJson,reply,requestOrigin,CheckoutError } from './checkout/_lib.js';
import { rawIdentity } from './auth/_profile.js';
const ready=new WeakSet(),blocked=new WeakMap(),limits=new Map();
let minute=0,total=0;
function limited(request){const now=Math.floor(Date.now()/60000);if(now!==minute){minute=now;total=0;limits.clear();}const ip=request.headers.get("CF-Connecting-IP")||"unknown",n=(limits.get(ip)||0)+1;if(++total>600||n>30||limits.size>=2000)return true;limits.set(ip,n);return false;}
export async function analyticsDb(env){
  const db=env.DVN_AUTH_DB;if(!db?.prepare)throw new CheckoutError('analytics_unavailable',503);
  if((blocked.get(db)||0)>Date.now())throw new CheckoutError('analytics_unavailable',503);
  if(!ready.has(db)){try{
    await db.prepare(`CREATE TABLE IF NOT EXISTS site_visits(session_id TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, path TEXT NOT NULL, device TEXT NOT NULL)`).bind().run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS site_views(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,at INTEGER NOT NULL,path TEXT NOT NULL,device TEXT NOT NULL)`).bind().run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS site_activity(session_id TEXT NOT NULL,bucket INTEGER NOT NULL,country TEXT NOT NULL,PRIMARY KEY(session_id,bucket))`).bind().run();
    await db.prepare('CREATE INDEX IF NOT EXISTS site_activity_bucket ON site_activity(bucket)').bind().run();
    await db.prepare('CREATE INDEX IF NOT EXISTS site_views_at ON site_views(at)').bind().run();
    await db.prepare('CREATE INDEX IF NOT EXISTS site_visits_seen ON site_visits(last_seen)').bind().run();ready.add(db);
  }catch{blocked.set(db,Date.now()+60000);throw new CheckoutError('analytics_unavailable',503);}}
  return db;
}
export async function onRequestPost({request,env}){
  const invalid=requestOrigin(request,true);if(invalid)return invalid;
  try{
    if(limited(request))return reply({error:'too_many_requests'},429);
    if(request.headers.get('DNT')==='1'||request.headers.get('Sec-GPC')==='1')return reply({ok:true,excluded:true});
    const input=await readJson(request,{limit:1024});
    const id=/^[a-f0-9-]{36}$/;
    if(!input||input.consent!==true||!id.test(input.session||'')||!id.test(input.view||'')||!['desktop','mobile','tablet'].includes(input.device)||!['view','heartbeat'].includes(input.kind)||typeof input.path!=='string'||!/^\/(?:shop|checkout|product|products\/[a-z0-9-]+)?$/.test(input.path))throw new CheckoutError('invalid_request');
    const user=await rawIdentity(request,env);if(user?.email.toLowerCase()==='account@dvnclothing.com')return reply({ok:true,excluded:true});
    const db=await analyticsDb(env),now=Math.floor(Date.now()/1000);
    // Bounded first-party telemetry: no IP, email, referrer, query or user agent is stored.
    await db.prepare(`INSERT INTO site_visits(session_id,first_seen,last_seen,path,device) VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET last_seen=excluded.last_seen,path=excluded.path,device=excluded.device WHERE site_visits.last_seen<=excluded.last_seen-45`).bind(input.session,now,now,input.path,input.device).run();
    const rawCountry=request.cf?.country;const country=typeof rawCountry==='string'&&/^[A-Z]{2}$/.test(rawCountry)?rawCountry:'XX';
    await db.prepare('INSERT OR IGNORE INTO site_activity(session_id,bucket,country) VALUES(?,?,?)').bind(input.session,Math.floor(now/300)*300,country).run();
    if(input.kind==='view')await db.prepare('INSERT OR IGNORE INTO site_views(id,session_id,at,path,device) VALUES(?,?,?,?,?)').bind(input.view,input.session,now,input.path,input.device).run();
    if(Math.random()<0.01){await db.prepare('DELETE FROM site_activity WHERE bucket<?').bind(now-30*86400).run();await db.prepare('DELETE FROM site_views WHERE at<?').bind(now-30*86400).run();await db.prepare('DELETE FROM site_visits WHERE last_seen<?').bind(now-30*86400).run();}
    return reply({ok:true});
  }catch(e){return reply({error:e instanceof CheckoutError?e.code:'analytics_unavailable'},e instanceof CheckoutError?e.status:503);}
}
