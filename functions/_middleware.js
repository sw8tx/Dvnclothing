import { clearPreviewAccess, hasPreview, previewJson, safePreviewNext } from './_preview.js';
import { privatePages } from './_private-pages.js';

const publicPages = new Map([
  ['/launch', '/launch'], ['/launch.html', '/launch'],
  ['/impressum', '/impressum'], ['/impressum.html', '/impressum'],
  ['/privacy', '/privacy'], ['/privacy.html', '/privacy'],
  ['/terms', '/terms'], ['/terms.html', '/terms'],
]);
const publicCode = /^\/(?:styles|hero|footer|legal|launch|countdown|translations|i18n|auth|account)(?:\.[a-f0-9]{16})?\.(?:css|js)$/;
const privateCode = /^\/(?:shop|storefront|store-cart|product|checkout|shirt-viewer)(?:\.[a-f0-9]{16})?\.(?:css|js)$/;
const publicImages = /^\/assets\/(?:brand\/|social\/|payments\/)?[a-zA-Z0-9_-]+\.(?:png|webp|jpe?g|svg|ico|css)$/;
const privateImages = /^\/assets\/(?:shop|products|lookbook)\/[a-zA-Z0-9_-]+\.(?:png|webp|jpe?g|svg)$/;
const privateModels = /^\/assets\/models\/(?:blue-mirage-black|blue-mirage-white|define-your-vision|blue-sunshine|purple-sunshine)\.glb$/;
const privateViewer = /^\/assets\/vendor\/model-viewer(?:\.min\.js|-LICENSE\.txt)$/;
const fontAsset = /^\/assets\/fonts\/[a-zA-Z0-9_-]+\.woff2?$/;
const mailPage = /^\/mail\/(?:login|bonus)\/(?:de|en)(?:\.html)?$/;
const storefrontPage = /^\/(?:index(?:\.html)?|shop(?:\.html)?)?\/?$/i;
const productPage = /^\/(?:product(?:\.html)?|products(?:\/[a-zA-Z0-9-]+)?)\/?$/;
const checkoutPage = /^\/checkout(?:\.html)?\/?$/;
// Pinned model-viewer 4.0.0 shadow stylesheet. GLB ImageBitmap textures are
// decoded through local blob URLs; no external connection origin is allowed.
const defaultCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-yhlpZVZMy2vXExwTGihUWVSrOxyhMuvj+Ygg7pyBWek='; img-src 'self' blob: data: https://*.googleusercontent.com; font-src 'self'; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function responseHeaders(response, { privateContent = false, varyCookie = false } = {}) {
  const result = new Response(response.body, response);
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  result.headers.set('Strict-Transport-Security', 'max-age=31536000');
  result.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (!result.headers.has('Content-Security-Policy')) result.headers.set('Content-Security-Policy', defaultCsp);
  if (privateContent || varyCookie) {
    result.headers.set('Cache-Control', 'private, no-store');
    result.headers.set('CDN-Cache-Control', 'no-store');
    result.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    result.headers.set('Pragma', 'no-cache');
    result.headers.set('Expires', '0');
    result.headers.delete('ETag');
    result.headers.delete('Last-Modified');
  }
  if (varyCookie) {
    const vary = (result.headers.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
    if (!vary.some(value => value.toLowerCase() === 'cookie')) vary.push('Cookie');
    result.headers.set('Vary', vary.join(', '));
  }
  if (privateContent) result.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return result;
}

function error(status) {
  return responseHeaders(new Response(status === 404 ? 'Not found' : 'Temporarily unavailable', {
    status, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  }), { privateContent: true });
}

function expectedType(path, html) {
  if (html) return /^text\/html(?:;|$)/i;
  if (path.endsWith('.js')) return /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i;
  if (path.endsWith('.css')) return /^text\/css(?:;|$)/i;
  if (path.endsWith('.json')) return /^application\/json(?:;|$)/i;
  if (/\.woff2?$/.test(path)) return /^(?:font\/woff2?|application\/(?:font-woff|octet-stream))(?:;|$)/i;
  if (path.endsWith('.glb')) return /^(?:model\/gltf-binary|application\/octet-stream)(?:;|$)/i;
  if (path.endsWith('.txt')) return /^text\/plain(?:;|$)/i;
  return /^image\//i;
}

async function asset(context, path, { html = false, privateContent = false, varyCookie = false } = {}) {
  if (!context.env.ASSETS?.fetch) return error(503);
  const target = new URL(context.request.url);
  target.pathname = path;
  target.search = '';
  const headers = new Headers(context.request.headers);
  headers.delete('Cookie');
  headers.delete('Authorization');
  // A conditional upstream 304 must not bypass response validation or turn
  // private content into a reusable response when the access cookie changes.
  if (privateContent || varyCookie) {
    headers.delete('If-None-Match');
    headers.delete('If-Modified-Since');
  }
  const response = await context.env.ASSETS.fetch(new Request(target, { method: context.request.method, headers }));
  if (!response.ok || !expectedType(path, html).test(response.headers.get('Content-Type') || '')) {
    // A missing public .js/image URL must not masquerade as a valid asset by
    // returning the Pages HTML fallback.
    return error(response.status >= 500 ? 503 : 404);
  }
  return responseHeaders(response, { privateContent, varyCookie });
}

function privateDocument(request, pages, path) {
  const document = Object.hasOwn(pages, path) ? pages[path] : null;
  if (!document || typeof document.body !== 'string' || !document.body ||
    !expectedType(path, path !== '/catalog.json').test(document.type || '')) return error(503);
  return responseHeaders(new Response(request.method === 'HEAD' ? null : document.body, {
    headers: { 'Content-Type': document.type },
  }), { privateContent: true, varyCookie: true });
}

function locked(request) {
  const url = new URL(request.url);
  const destination = new URL('/', 'https://dvnclothing.com');
  destination.searchParams.set('preview', 'required');
  destination.searchParams.set('next', safePreviewNext(url.pathname + url.search));
  return clearPreviewAccess(responseHeaders(Response.redirect(destination.href, 302), { privateContent: true, varyCookie: true }));
}

// Entry behaviour only: authentication always requires the signed preview cookie.
// Typed/bookmarked/external links must return to the password entrance even when
// an earlier visit left a valid cookie. Internal shopping navigation stays usable.
function internalNavigation(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin';
  try { return new URL(request.headers.get('Referer')).origin === new URL(request.url).origin; }
  catch { return false; }
}

async function previewMiddleware(context, pages) {
  const { request } = context;
  const url = new URL(request.url);
  // Customer identity continues to be checked by the existing account API;
  // the shared preview credential never grants customer-account access.
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/checkout/')) {
      try {
        if (!await hasPreview(request, context.env)) return previewJson({ error: 'preview_required' }, 401);
      } catch { return previewJson({ error: 'unavailable' }, 503); }
    }
    return context.next();
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return previewJson({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }
  const path = url.pathname;
  try {
    // The homepage is always the launch entrance, including for returning
    // preview visitors. Successful password entry continues to /shop.
    if (path === '/' || publicPages.get(path) === '/launch') {
      return clearPreviewAccess(await asset(context, '/launch', { html: true, varyCookie: true }));
    }
    if (publicPages.has(path)) return await asset(context, publicPages.get(path), { html: true });
    if (mailPage.test(path)) return await asset(context, path.replace(/\.html$/, ''), { html: true });
    if (publicCode.test(path) || publicImages.test(path) || fontAsset.test(path) || path === '/assets/fonts/OFL-Manrope.txt') {
      return await asset(context, path);
    }
    const store = storefrontPage.test(path);
    const product = productPage.test(path);
    const checkout = checkoutPage.test(path);
    const privateAsset = privateCode.test(path) || privateImages.test(path) || privateModels.test(path) || privateViewer.test(path) || path === '/catalog.json';
    if (!store && !product && !checkout && !privateAsset) return error(404);
    const unlocked = await hasPreview(request, context.env);
    if (!unlocked || (!privateAsset && !internalNavigation(request))) return privateAsset ? previewJson({ error: 'preview_required' }, 401) : locked(request);
    if (path === '/catalog.json') return privateDocument(request, pages, '/catalog.json');
    if (privateAsset) return await asset(context, path, { privateContent: true, varyCookie: true });
    // These documents exist only in the function bundle, never in the static
    // deployment. If Pages bypasses functions after exhausting its allowance,
    // static serving can return the public launch page but no private document.
    return privateDocument(request, pages, product ? '/product' : checkout ? '/checkout' : '/shop');
  } catch {
    return error(503);
  }
}

export function createPreviewMiddleware(pages) {
  return context => previewMiddleware(context, pages);
}

export const onRequest = createPreviewMiddleware(privatePages);
