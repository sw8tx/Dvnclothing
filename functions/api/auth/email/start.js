import { signInMessage } from './_message.js';
import { cookie, random, seal, setCookie } from '../_lib.js';
import { rawIdentity } from '../_profile.js';
import { body, challengeCookie, generateCode, json, lifetime, mac, normalizeEmail, sameLinkMailbox, validateRequest } from './_shared.js';

// Admission and quota reservation are one SQLite write, including under concurrent sends.
const reserve = `
  INSERT INTO email_login_attempts (challenge_key, code_mac, email_key, ip_key, issued_at, active)
  SELECT ?1, ?2, ?3, ?4, ?5, 1
  WHERE NOT EXISTS (SELECT 1 FROM email_login_attempts WHERE email_key = ?3 AND issued_at > ?5 - 60)
    AND (SELECT count(*) FROM email_login_attempts WHERE email_key = ?3 AND issued_at > ?5 - 3600) < 5
    AND (SELECT count(*) FROM email_login_attempts WHERE ip_key = ?4 AND issued_at > ?5 - 3600) < 20
    AND (SELECT count(*) FROM email_login_attempts WHERE issued_at > ?5 - 3600) < 300
`;

async function submitMail(env, message, deliveryKey) {
  const headers = {
    Authorization: 'Bearer ' + env.RESEND_API_KEY,
    'Content-Type': 'application/json',
    'Idempotency-Key': deliveryKey,
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers, body: message, signal: controller.signal,
      });
      if (response.ok) return true;
      console.warn('email_auth_start', { stage: 'resend', attempt, status: response.status });
      if (response.status < 500 && response.status !== 408) return false;
    } catch {
      console.warn('email_auth_start', { stage: 'resend', attempt, category: controller.signal.aborted ? 'timeout' : 'transport' });
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

export async function onRequestPost({ request, env }) {
  const invalid = validateRequest(request, env);
  if (invalid) return invalid;
  const payload = await body(request);
  const email = normalizeEmail(payload?.email);
  if (!email) return json({ error: 'invalid' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const challenge = random();
  const code = generateCode();
  const secret = env.AUTH_COOKIE_SECRET;
  let stage = 'prepare';
  try {
    const claims = { challenge, email, exp: now + lifetime };
    if (payload.purpose === 'link') {
      const google = await rawIdentity(request, env);
      if (!google || google.provider !== 'google') return json({ error: 'login_required' }, 401);
      if (!sameLinkMailbox(google.email, email)) return json({ error: 'link_conflict' }, 409);
      const sessionKey = await mac(secret, 'link-session', cookie(request, '__Host-dvn-session'));
      claims.linking = { googleId: google.id, sessionKey };
    }
    const [challengeKey, codeMac, emailKey, ipKey, pending] = await Promise.all([
      mac(secret, 'challenge', challenge), mac(secret, 'code', challenge + ':' + code),
      mac(secret, 'email', email.toLowerCase()), mac(secret, 'ip', request.headers.get('CF-Connecting-IP') || 'unknown'),
      seal(claims, secret + ':email-challenge-v1'),
    ]);
    // Prepare the browser response before sending. Only a confirmed provider
    // acceptance releases this cookie, which is required to use the active row.
    const accepted = json({ sent: true }, 202);
    setCookie(accepted, challengeCookie, pending, lifetime);
    const db = env.DVN_AUTH_DB;
    stage = 'reserve';
    const [, admission] = await db.batch([
      db.prepare('DELETE FROM email_login_attempts WHERE issued_at <= ?').bind(now - 3600),
      db.prepare(reserve).bind(challengeKey, codeMac, emailKey, ipKey, now),
    ]);
    if (admission.meta.changes !== 1) return json({ error: 'rate_limited' }, 429);
    stage = 'resend';
    const message = JSON.stringify({
      from: 'DVN CLOTHING <account@dvnclothing.com>',
      to: [email],
      ...signInMessage(code, payload.language ?? payload.lang, lifetime),
    });
    if (await submitMail(env, message, 'dvn-login-' + challengeKey)) return accepted;
    return json({ error: 'unavailable' }, 503);
  } catch {
    console.warn('email_auth_start', { stage, category: 'internal' });
    return json({ error: 'unavailable' }, 503);
  }
}
