import { clearCookie, cookie, seal, setCookie, unseal } from '../_lib.js';
import { body, challengeCookie, json, lifetime, mac, validateRequest } from './_shared.js';

// At most five comparisons; a matching request sets consumed before issuing a session.
const consume = `
  UPDATE email_login_attempts
  SET tries = tries + 1, consumed = CASE WHEN code_mac = ?1 THEN 1 ELSE 0 END
  WHERE challenge_key = ?2 AND issued_at > ?3 AND active = 1 AND consumed = 0 AND tries < 5
  RETURNING consumed
`;

export async function onRequestPost({ request, env }) {
  const invalid = validateRequest(request, env);
  if (invalid) return invalid;
  const payload = await body(request);
  if (typeof payload?.code !== 'string' || !/^\d{6}$/.test(payload.code)) return json({ error: 'invalid_code' }, 400);
  const secret = env.AUTH_COOKIE_SECRET;
  const pending = await unseal(cookie(request, challengeCookie), secret + ':email-challenge-v1');
  if (!pending?.challenge || !pending.email) return json({ error: 'invalid_code' }, 400);
  const now = Math.floor(Date.now() / 1000);
  try {
    const [challengeKey, codeMac] = await Promise.all([
      mac(secret, 'challenge', pending.challenge), mac(secret, 'code', pending.challenge + ':' + payload.code),
    ]);
    const used = await env.DVN_AUTH_DB.prepare(consume).bind(codeMac, challengeKey, now - lifetime).first();
    if (used?.consumed !== 1) return json({ error: 'invalid_code' }, 400);
    const user = { name: pending.email, email: pending.email, picture: '' };
    const age = 7 * 86400;
    const session = await seal({ ...user, sub: 'email:' + pending.email, exp: now + age }, secret);
    const result = json({ user });
    clearCookie(result, challengeCookie);
    setCookie(result, '__Host-dvn-session', session, age);
    return result;
  } catch { return json({ error: 'unavailable' }, 503); }
}
