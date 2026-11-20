import { random, seal, setCookie } from '../_lib.js';
import { body, challengeCookie, generateCode, json, lifetime, mac, normalizeEmail, validateRequest } from './_shared.js';

// Admission and quota reservation are one SQLite write, including under concurrent sends.
const reserve = `
  INSERT INTO email_login_attempts (challenge_key, code_mac, email_key, ip_key, issued_at)
  SELECT ?1, ?2, ?3, ?4, ?5
  WHERE NOT EXISTS (SELECT 1 FROM email_login_attempts WHERE email_key = ?3 AND issued_at > ?5 - 60)
    AND (SELECT count(*) FROM email_login_attempts WHERE email_key = ?3 AND issued_at > ?5 - 3600) < 5
    AND (SELECT count(*) FROM email_login_attempts WHERE ip_key = ?4 AND issued_at > ?5 - 3600) < 20
    AND (SELECT count(*) FROM email_login_attempts WHERE issued_at > ?5 - 3600) < 300
`;

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
  try {
    const [challengeKey, codeMac, emailKey, ipKey] = await Promise.all([
      mac(secret, 'challenge', challenge), mac(secret, 'code', challenge + ':' + code),
      mac(secret, 'email', email.toLowerCase()), mac(secret, 'ip', request.headers.get('CF-Connecting-IP') || 'unknown'),
    ]);
    const db = env.DVN_AUTH_DB;
    const [, admission] = await db.batch([
      db.prepare('DELETE FROM email_login_attempts WHERE issued_at <= ?').bind(now - 3600),
      db.prepare(reserve).bind(challengeKey, codeMac, emailKey, ipKey, now),
    ]);
    if (admission.meta.changes !== 1) return json({ error: 'rate_limited' }, 429);
    const en = (payload.language ?? payload.lang) === 'en';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        from: 'DVN CLOTHING <account@dvnclothing.com>', to: [email],
        subject: en ? 'Your DVN sign-in code' : 'Dein DVN-Anmeldecode',
        text: en ? 'Your DVN sign-in code is ' + code + '. It is valid for 10 minutes in the browser where you requested it. If you did not request this code, ignore this email.'
          : 'Dein DVN-Anmeldecode lautet ' + code + '. Er gilt 10 Minuten in dem Browser, in dem du ihn angefordert hast. Falls du diesen Code nicht angefordert hast, ignoriere diese E-Mail.',
      }),
    });
    if (!response.ok) return json({ error: 'unavailable' }, 503);
    await db.prepare('UPDATE email_login_attempts SET active = 1 WHERE challenge_key = ?').bind(challengeKey).run();
    const pending = await seal({ challenge, email, exp: now + lifetime }, secret + ':email-challenge-v1');
    const result = json({ sent: true }, 202);
    setCookie(result, challengeCookie, pending, lifetime);
    return result;
  } catch { return json({ error: 'unavailable' }, 503); }
}
