import { clearCookie, cookie, seal, setCookie, unseal } from '../_lib.js';
import { linkAccounts } from '../_links.js';
import { identityFromClaims, rawIdentity } from '../_profile.js';
import { body, challengeCookie, json, lifetime, mac, sameLinkMailbox, validateRequest } from './_shared.js';

const eligible = 'challenge_key = ? AND issued_at > ? AND active = 1 AND consumed = 0 AND tries < 5';
const match = `UPDATE email_login_attempts SET tries = tries + 1, consumed = 1 WHERE ${eligible} AND code_mac = ?`;
const mismatch = `UPDATE email_login_attempts SET tries = tries + 1 WHERE ${eligible} AND code_mac <> ?`;

function databaseCategory(error) {
  const messages = [error?.message, error?.cause?.message].join(' ');
  if (/\b(?:daily|today|per day|in a day|midnight)\b/i.test(messages) && /quota|limit|allowance/i.test(messages)) return 'daily_quota';
  if (/quota|daily.*limit|limit.*daily|free tier/i.test(messages)) return 'quota';
  return 'database';
}

export async function onRequestPost({ request, env }) {
  const invalid = validateRequest(request, env);
  if (invalid) return invalid;
  const payload = await body(request);
  if (typeof payload?.code !== 'string' || !/^\d{6}$/.test(payload.code)) return json({ error: 'invalid_code' }, 400);
  const secret = env.AUTH_COOKIE_SECRET;
  const pending = await unseal(cookie(request, challengeCookie), secret + ':email-challenge-v1');
  if (!pending?.challenge || !pending.email) return json({ error: 'invalid_code' }, 400);
  const now = Math.floor(Date.now() / 1000);
  let stage = 'prepare';
  try {
    const [challengeKey, codeMac] = await Promise.all([
      mac(secret, 'challenge', pending.challenge),
      mac(secret, 'code', pending.challenge + ':' + payload.code),
    ]);
    const user = { name: pending.email, email: pending.email, picture: '' };
    const claims = { ...user, sub: 'email:' + pending.email };
    let google, emailAccount, accepted;
    if (pending.linking) {
      google = await rawIdentity(request, env);
      const sessionKey = await mac(secret, 'link-session', cookie(request, '__Host-dvn-session'));
      if (google?.provider !== 'google' || google.id !== pending.linking.googleId ||
          !sameLinkMailbox(google.email, pending.email) || sessionKey !== pending.linking.sessionKey) {
        return json({ error: 'link_conflict' }, 409);
      }
      emailAccount = await identityFromClaims(claims);
      accepted = json({ linked: true });
    } else {
      const age = 7 * 86400;
      const session = await seal({ ...claims, exp: now + age }, secret);
      accepted = json({ user });
      setCookie(accepted, '__Host-dvn-session', session, age);
    }
    clearCookie(accepted, challengeCookie);
    clearCookie(accepted, '__Host-dvn-pending');

    // Both writes run in one D1 transaction; only one can match. No session
    // leaves this function until D1 confirms this request consumed the code.
    stage = 'consume';
    const db = env.DVN_AUTH_DB;
    const values = [challengeKey, now - lifetime, codeMac];
    const results = await db.batch([
      db.prepare(match).bind(...values),
      db.prepare(mismatch).bind(...values),
    ]);
    const counts = results.map(result => result.success === false ? null : result.meta?.changes);
    if (counts.length !== 2 || !counts.every(count => count === 0 || count === 1) || counts[0] + counts[1] > 1) {
      console.warn('email_auth_verify', { stage, category: 'unconfirmed_write' });
      return json({ error: 'unavailable' }, 503);
    }
    if (counts[0] === 0) return json({ error: 'invalid_code' }, 400);
    if (google) {
      stage = 'link';
      if (!await linkAccounts(env, emailAccount, google)) return json({ error: 'link_conflict' }, 409);
    }
    return accepted;
  } catch (error) {
    const category = stage === 'prepare' ? 'internal' : databaseCategory(error);
    console.warn('email_auth_verify', { stage, category });
    const response = json({ error: category === 'daily_quota' ? 'store_daily_limit' : 'verification_unavailable' }, 503);
    if (category === 'daily_quota') {
      const observedAt = Math.floor(Date.now() / 1000);
      response.headers.set('Date', new Date(observedAt * 1000).toUTCString());
      response.headers.set('Retry-After', String(86400 - observedAt % 86400));
    }
    return response;
  }
}
