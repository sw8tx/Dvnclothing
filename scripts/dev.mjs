// Local preview adapter only. Production uses native Cloudflare Pages handlers.
import http from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequest as gate } from '../functions/_middleware.js';
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';
import { privatePages } from '../functions/_private-pages.js';
const root=fileURLToPath(new URL('../',import.meta.url)),dist=path.join(root,'dist');
const secret=randomBytes(48).toString('hex');
// Optional, isolated visual fixture. It never loads production credentials or
// customer data and this adapter is not part of the Cloudflare deployment.
const visualFixture=process.env.DVN_VISUAL_QA==='1';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain'};
const env={AUTH_COOKIE_SECRET:secret,ASSETS:{fetch:async request=>{
  let filename=decodeURIComponent(new URL(request.url).pathname);if(filename==='/')filename='/index.html';
  if(!path.extname(filename))filename+='.html';
  let file=path.resolve(dist,'.'+filename);if(!file.startsWith(dist+path.sep))return new Response('Not found',{status:404});
  try{if(!(await stat(file)).isFile())throw new Error();}catch{file=path.join(dist,'index.html');}
  return new Response(request.method==='HEAD'?null:await readFile(file),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}});
}}};
const apiModules=new Map();
for(const route of ['preview/unlock','preview/logout','checkout/config','checkout/session','auth/session','auth/logout'])apiModules.set('/api/'+route,await import('../functions/api/'+route+'.js'));
const server=http.createServer(async(req,res)=>{
 try{
  const displayOrigin='http://'+req.headers.host;
  const url=new URL(req.url,displayOrigin);const canonical='https://dvnclothing.com'+url.pathname+url.search;
  const headers=new Headers();for(const [key,value]of Object.entries(req.headers)){if(value)headers.set(key,Array.isArray(value)?value.join(','):value);}
  const incomingOrigin=headers.get('Origin');
  // Translate only this local preview's own browser origin for production CSRF checks.
  if(incomingOrigin){try{if(new URL(incomingOrigin).host===req.headers.host)headers.set('Origin','https://dvnclothing.com');}catch{}}
  const request=new Request(canonical,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
  const context={request,env,waitUntil:()=>{},next:()=>apiMiddleware({request,env,next:async()=>{
    const module=apiModules.get(url.pathname);const handler=module?.['onRequest'+req.method[0]+req.method.slice(1).toLowerCase()]||module?.onRequest;
    return handler?handler({request,env,waitUntil:()=>{}}):Response.json({error:'preview_only'},{status:503});
  }})};
  let response;
  if(visualFixture&&['GET','HEAD'].includes(req.method)&&!url.pathname.startsWith('/api/')){
    if(url.pathname==='/__visual-mobile'){
      const requested=url.searchParams.get('page');
      const page=['/shop','/products/blue-mirage-black','/checkout','/launch.html'].includes(requested)?requested:'/shop';
      response=new Response(`<!doctype html><html><head><meta charset="utf-8"><title>DVN mobile layout test</title></head><body style="margin:0;background:#dedede;display:flex;justify-content:center"><iframe title="DVN mobile preview" src="${page}" style="border:0;width:390px;height:844px;max-width:100%;background:white"></iframe></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    }else{
    const key=url.pathname.startsWith('/products/')?'/product':url.pathname;
    const page=privatePages[key];
    response=page?new Response(page.body,{headers:{'Content-Type':page.type,'Cache-Control':'no-store'}}):await env.ASSETS.fetch(request);
    }
    response.headers.set('X-DVN-Local-Visual-Fixture','true');
  }else response=await gate(context);
  res.statusCode=response.status;
  for(const [key,value]of response.headers){if(key.toLowerCase()!=='set-cookie')res.setHeader(key,value);}
  const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
  if(req.method==='HEAD')res.end();else res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.statusCode=500;res.end('Local preview error');}
});
const portArgument=process.argv.indexOf('--port');
const port=Number(portArgument>=0?process.argv[portArgument+1]:(process.env.PORT||5173));
server.listen(port,'0.0.0.0',()=>console.log(`DVN local preview listening on ${port}`));
