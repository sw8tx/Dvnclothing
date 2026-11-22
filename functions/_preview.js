import { clearCookie, cookie, encode, noStore, origin, seal, setCookie, unseal } from './api/auth/_lib.js';

export const previewCookie = '__Host-dvn-preview';
export const attemptsCookie = '__Host-dvn-preview-attempts';
export const previewLifetime = 12 * 60 * 60;
const audience = 'https://dvnclothing.com';
const purpose = 'dvn-storefront-preview-v1';
const attemptsPurpose = 'dvn-storefront-preview-attempts-v1';
const defaultPasswordHash = '4f0c33a7e32c330a988607ae480aec225aa499649d478d1c1ec31ffa057f26de';
const encoder = new TextEncoder();
const attemptWindow = 15 * 60;
const attemptLimit = 5;
const cooldown = 60;
// This supplements the signed browser cooldown without consuming database
// reads. It is deliberately bounded and is not a distributed rate limiter.
const ipAttempts = new Map();
const maxIpEntries = 1024;

function passwordHash(env) {
  const value = env.PREVIEW_PASSWORD_SHA256 === undefined ? defaultPasswordHash : env.PREVIEW_PASSWORD_SHA256;
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value) ? value.toLowerCase() : null;
}

export function previewReady(env = {}) {
  return typeof env.AUTH_COOKIE_SECRET === 'string' && env.AUTH_COOKIE_SECRET.length >= 32 && Boolean(passwordHash(env));
}

async function hmacKey(secret, usage = ['sign', 'verify']) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

async function signingSecret(env) {
  if (!previewReady(env)) return null;
  // A separate, password-version-bound key means a preview cookie cannot be
  // renamed into an account session, and changing the hash revokes previews.
  const key = await hmacKey(env.AUTH_COOKIE_SECRET, ['sign']);
  return encode(await crypto.subtle.sign('HMAC', key, encoder.encode(purpose + ':' + passwordHash(env))));
}

export async function hasPreview(request, env) {
  if (new URL(request.url).origin !== audience) return false;
  const token = cookie(request, previewCookie);
  if (!token) return false;
  const secret = await signingSecret(env);
  if (!secret) return false;
  const claims = await unseal(token, secret);
  const now = Math.floor(Date.now() / 1000);
  return Boolean(claims && claims.purpose === purpose && claims.aud === audience &&
    Number.isInteger(claims.iat) && claims.iat <= now + 60 &&
    claims.exp > claims.iat && claims.exp <= claims.iat + previewLifetime);
}

export function previewJson(data, status = 200, headers = {}) {
  return noStore(Response.json(data, { status, headers }));
}

export function validatePreviewRequest(request, env) {
  const site = origin(request);
  if (!site || new URL(request.url).origin !== site || request.headers.get('Origin') !== site) {
    return previewJson({ error: 'invalid_origin' }, 403);
  }
  if (!previewReady(env)) return previewJson({ error: 'unavailable' }, 503, { 'Retry-After': '60' });
  return null;
}

export async function readPreviewBody(request, timeoutMs = 3000) {
  if (!request.body || Number(request.headers.get('Content-Length')) > 2048) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let timeout;
  const deadline = new Promise(resolve => { timeout = setTimeout(() => resolve(null), timeoutMs); });
  const cancel = () => { reader.cancel().catch(() => {}); };
  let bytes = 0;
  let value = '';
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (!part) {
        cancel();
        return null;
      }
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2048) {
        cancel();
        return null;
      }
      value += decoder.decode(part.value, { stream: true });
    }
    const data = JSON.parse(value + decoder.decode());
    return data && !Array.isArray(data) && typeof data.password === 'string' &&
      data.password.length > 0 && data.password.length <= 256 ? data : null;
  } catch {
    cancel();
    return null;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

export async function matchesPreviewPassword(password, env) {
  const expected = passwordHash(env);
  if (!previewReady(env) || typeof password !== 'string') return false;
  const expectedBytes = Uint8Array.from(expected.match(/../g), hex => parseInt(hex, 16));
  const suppliedBytes = await crypto.subtle.digest('SHA-256', encoder.encode(password));
  // Compare fixed-size digests through Web Crypto's cryptographic verification
  // primitive rather than short-circuiting string or JavaScript byte equality.
  const key = await hmacKey(await signingSecret(env));
  const signature = await crypto.subtle.sign('HMAC', key, expectedBytes);
  return crypto.subtle.verify('HMAC', key, signature, suppliedBytes);
}

export function safePreviewNext(value) {
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('/') ||
    value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/shop';
  try {
    const target = new URL(value, audience);
    if (target.origin !== audience || !/^\/(?:admin\/orders|shop\/?|checkout\/?|products(?:\/[a-zA-Z0-9-]+)?\/?)$/.test(target.pathname)) return '/shop';
    return target.pathname + target.search + target.hash;
  } catch { return '/shop'; }
}

export async function previewAttempts(request, env) {
  const secret = await signingSecret(env);
  const now = Math.floor(Date.now() / 1000);
  const claims = await unseal(cookie(request, attemptsCookie), secret);
  const browser = claims?.purpose === attemptsPurpose && Number.isInteger(claims.tries) &&
    claims.tries >= 0 && claims.tries <= attemptLimit && Number.isInteger(claims.until) &&
    claims.until >= 0 && claims.until <= now + cooldown && claims.exp <= now + attemptWindow
    ? claims : { tries: 0, until: 0, exp: now + attemptWindow };
  const ip = request.headers.get('CF-Connecting-IP');
  const ipKey = ip && ip.length <= 64
    ? encode(await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), encoder.encode('preview-ip:' + ip))) : '';
  const stored = ipKey && ipAttempts.get(ipKey);
  const address = stored && stored.exp > now ? stored : { tries: 0, until: 0, exp: now + attemptWindow };
  return { secret, ipKey, now, tries: Math.max(browser.tries, address.tries),
    until: Math.max(browser.until, address.until), exp: Math.max(browser.exp, address.exp) };
}

export function previewCooldown(state) {
  const retryAfter = Math.max(0, state.until - state.now);
  return retryAfter ? previewJson({ error: 'too_many_attempts', retryAfter }, 429, { 'Retry-After': String(retryAfter) }) : null;
}

export async function failedPreview(state) {
  const tries = Math.min(attemptLimit, state.tries + 1);
  const until = tries >= attemptLimit ? state.now + cooldown : 0;
  const claims = { purpose: attemptsPurpose, tries, until, exp: state.exp };
  if (state.ipKey) {
    if (!ipAttempts.has(state.ipKey) && ipAttempts.size >= maxIpEntries) {
      for (const [key, value] of ipAttempts) if (value.exp <= state.now) ipAttempts.delete(key);
      if (ipAttempts.size >= maxIpEntries) ipAttempts.delete(ipAttempts.keys().next().value);
    }
    ipAttempts.set(state.ipKey, claims);
  }
  const response = previewCooldown({ ...state, until }) || previewJson({ error: 'invalid_password' }, 401);
  setCookie(response, attemptsCookie, await seal(claims, state.secret), Math.max(1, state.exp - state.now));
  return response;
}

export async function grantPreview(response, env, state) {
  const iat = Math.floor(Date.now() / 1000);
  const token = await seal({ purpose, aud: audience, iat, exp: iat + previewLifetime }, await signingSecret(env));
  setCookie(response, previewCookie, token, previewLifetime);
  clearCookie(response, attemptsCookie);
  if (state.ipKey) ipAttempts.delete(state.ipKey);
  return response;
}

export function clearPreviewAccess(response) {
  clearCookie(response, previewCookie);
  return response;
}

export function clearPreview(response) {
  clearPreviewAccess(response);
  clearCookie(response, attemptsCookie);
  return response;
}
