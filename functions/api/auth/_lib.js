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
    if (typeof value !== 'string' || value.length > 4096) return null;
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
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
}

export function origin(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || !['dvnclothing.com', 'www.dvnclothing.com'].includes(url.hostname)) return null;
  return 'https://dvnclothing.com';
}

export function ready(env) { return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.AUTH_COOKIE_SECRET?.length >= 32); }

export async function verifyGoogleToken(idToken, clientId, nonce) {
  if (typeof idToken !== 'string' || idToken.length > 16384) throw Error('Invalid ID token');
  const chunks = idToken?.split('.');
  if (chunks?.length !== 3) throw Error('Invalid ID token');
  const header = JSON.parse(new TextDecoder().decode(decode(chunks[0])));
  const claims = JSON.parse(new TextDecoder().decode(decode(chunks[1])));
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid ||
      claims.aud !== clientId || (claims.azp !== undefined && claims.azp !== clientId) ||
      !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
      typeof nonce !== 'string' || !nonce || claims.nonce !== nonce ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 || claims.sub.startsWith('email:') ||
      typeof claims.email !== 'string' || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(claims.email) ||
      claims.email_verified !== true || !Number.isInteger(claims.exp) || claims.exp <= now ||
      !Number.isInteger(claims.iat) || claims.iat > now + 60 || claims.exp <= claims.iat) throw Error('Invalid Google claims');
  const keysResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    signal: AbortSignal.timeout(9000), redirect: 'manual',
  });
  if (!keysResponse.ok) throw Error('Google verification unavailable');
  const { keys } = await keysResponse.json();
  const jwk = keys?.find((item) => item.kid === header.kid && item.kty === 'RSA' && item.use === 'sig');
  if (!jwk) throw Error('Google signing key unavailable');
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decode(chunks[2]), encoder.encode(`${chunks[0]}.${chunks[1]}`));
  if (!valid) throw Error('Invalid Google signature');
  const name = typeof claims.name === 'string'
    ? Array.from(claims.name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '').trim()).slice(0, 64).join('') : '';
  let picture = '';
  try {
    const photo = new URL(claims.picture);
    if (photo.protocol === 'https:' && !photo.username && !photo.password && !photo.port &&
        photo.hostname.endsWith('.googleusercontent.com') && photo.href.length <= 1024) picture = photo.href;
  } catch { /* A photo is optional and never identifies the account. */ }
  return { sub: claims.sub, email: claims.email, name: name || claims.email, picture };
}
