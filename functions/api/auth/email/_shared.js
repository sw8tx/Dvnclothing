import { encode, noStore, origin } from '../_lib.js';

export const challengeCookie = '__Host-dvn-email-challenge';
export const lifetime = 600;
export function emailReady(env) {
  return Boolean(env.DVN_AUTH_DB?.prepare && env.RESEND_API_KEY && env.AUTH_COOKIE_SECRET?.length >= 32);
}

export function json(value, status = 200) {
  return noStore(Response.json(value, { status }));
}

export function validateRequest(request, env) {
  const site = origin(request);
  if (!site || new URL(request.url).origin !== site || request.headers.get('Origin') !== site) {
    return json({ error: 'invalid' }, 403);
  }
  if (!emailReady(env)) return json({ error: 'unavailable' }, 503);
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'invalid' }, 400);
  }
  return null;
}

export async function body(request) {
  if (!request.body || Number(request.headers.get('Content-Length')) > 2048) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2048) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { return null; }
}

export async function mac(secret, kind, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode('dvn-email-v1:' + kind + ':' + value));
  return encode(bytes);
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length > 254) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) return null;
  return local + '@' + domain.toLowerCase();
}

export function generateCode() {
  const sample = new Uint32Array(1);
  const upper = 2 ** 32 - (2 ** 32 % 1_000_000);
  do { crypto.getRandomValues(sample); } while (sample[0] >= upper);
  return String(sample[0] % 1_000_000).padStart(6, '0');
}
