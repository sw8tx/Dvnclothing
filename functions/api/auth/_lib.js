const encoder = new TextEncoder();
const cookieOptions = 'Path=/; Secure; HttpOnly; SameSite=Lax';

export function cookie(request, name) {
  const part = (request.headers.get('Cookie') || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(name + '='));
  return part ? part.slice(name.length + 1) : '';
}

export function encode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decode(value) {
  const input = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(input.padEnd(Math.ceil(input.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}

export function random() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}

async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function seal(data, secret) {
  const body = encode(encoder.encode(JSON.stringify(data)));
  const signature = encode(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body)));
  return `${body}.${signature}`;
}

export async function unseal(value, secret) {
  try {
    const [body, signature, extra] = value.split('.');
    if (!body || !signature || extra || !await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(body))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(body)));
    return Number.isFinite(data.exp) && data.exp > Date.now() / 1000 ? data : null;
  } catch { return null; }
}

export function setCookie(response, name, value, age) {
  response.headers.append('Set-Cookie', `${name}=${value}; ${cookieOptions}; Max-Age=${age}`);
}

export function clearCookie(response, name) { setCookie(response, name, '', 0); }

export function noStore(response) {
  // Response.redirect creates immutable headers in standards-compliant runtimes.
  response = new Response(response.body, response);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export function origin(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || !['dvnclothing.com', 'www.dvnclothing.com'].includes(url.hostname)) return null;
  return 'https://dvnclothing.com';
}

export function ready(env) { return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.AUTH_COOKIE_SECRET?.length >= 32); }

export async function verifyGoogleToken(idToken, clientId, nonce) {
  const chunks = idToken?.split('.');
  if (chunks?.length !== 3) throw Error('Invalid ID token');
  const header = JSON.parse(new TextDecoder().decode(decode(chunks[0])));
  const claims = JSON.parse(new TextDecoder().decode(decode(chunks[1])));
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || !header.kid || claims.aud !== clientId || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub || claims.sub.startsWith('email:') || typeof claims.email !== 'string' || !claims.email || claims.email_verified !== true || !Number.isInteger(claims.exp) || claims.exp <= now || !Number.isInteger(claims.iat) || claims.iat > now + 60) throw Error('Invalid Google claims');
  const keysResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!keysResponse.ok) throw Error('Google verification unavailable');
  const { keys } = await keysResponse.json();
  const jwk = keys?.find((item) => item.kid === header.kid && item.kty === 'RSA' && item.use === 'sig');
  if (!jwk) throw Error('Google signing key unavailable');
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decode(chunks[2]), encoder.encode(`${chunks[0]}.${chunks[1]}`));
  if (!valid) throw Error('Invalid Google signature');
  return { sub: claims.sub, email: claims.email, name: claims.name || claims.email, picture: claims.picture || '' };
}
