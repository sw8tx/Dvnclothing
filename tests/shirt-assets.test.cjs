const { test } = require('node:test');
const assert = require('node:assert/strict');
const site = 'https://dvnclothing.com';
const env = { AUTH_COOKIE_SECRET: 'test-preview-cookie-secret-with-at-least-32-characters' };
const paths = [
  '/shirt-viewer.js', '/shirt-viewer.css', '/shirt-viewer.0123456789abcdef.js',
  '/assets/vendor/model-viewer.min.js',
  ...['blue-mirage-black','blue-mirage-white','define-your-vision','blue-sunshine','purple-sunshine'].map(id=>`/assets/models/${id}.glb`),
];
async function session(){
  const { onRequestPost } = await import('../functions/api/preview/unlock.js');
  const r = await onRequestPost({env, request:new Request(site+'/api/preview/unlock', {method:'POST', headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify({password:'dvnclothing'})})});
  return r.headers.getSetCookie().find(c=>c.startsWith('__Host-dvn-preview=')).split(';')[0];
}
async function get(path,cookie='',mime){
  const { createPreviewMiddleware } = await import('../functions/_middleware.js');
  let fetched=0;
  const response=await createPreviewMiddleware({})({request:new Request(site+path,{headers:{Cookie:cookie}}),env:{...env,ASSETS:{fetch:async()=>{fetched++;return new Response('test bytes',{headers:{'Content-Type':mime || (path.endsWith('.glb')?'model/gltf-binary':path.endsWith('.css')?'text/css':'application/javascript')}});}}},next(){throw Error('escaped gate');}});
  return {response,fetched};
}
test('3D models and lazy viewer stay private until the launch password is accepted',async()=>{
  for(const path of paths){const {response,fetched}=await get(path);assert.equal(response.status,401,path);assert.equal(fetched,0);}
  const cookie=await session();
  for(const path of paths){const {response,fetched}=await get(path,cookie);assert.equal(response.status,200,path);assert.equal(fetched,1);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie');
    const csp=response.headers.get('Content-Security-Policy');
    assert.match(csp, /script-src 'self';/);
    assert.match(csp, /style-src 'self' 'sha256-yhlpZVZMy2vXExwTGihUWVSrOxyhMuvj\+Ygg7pyBWek=';/);
    assert.match(csp, /connect-src 'self' blob:;/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  }
});
test('missing models cannot become the HTML fallback and arbitrary model paths are rejected',async()=>{
  const cookie=await session();
  assert.equal((await get('/assets/models/blue-sunshine.glb',cookie,'text/html')).response.status,404);
  assert.equal((await get('/assets/models/blue-sunshine.glb',cookie,'application/octet-stream')).response.status,200);
  for(const path of ['/assets/models/unlisted.glb','/assets/vendor/unlisted.js','/assets/models/README.md']){const {response,fetched}=await get(path,cookie);assert.equal(response.status,404,path);assert.equal(fetched,0);}
});
