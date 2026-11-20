import { signInMessage } from './_message.js';
import { cookie, random, seal, setCookie } from '../_lib.js';
import { rawIdentity } from '../_profile.js';
import { body, challengeCookie, generateCode, json, lifetime, mac, normalizeEmail, sameLinkMailbox, validateRequest } from './_shared.js';

// Each indexed probe stops once it reaches the first disqualifying row.
const preflight = `
  SELECT (SELECT issued_at FROM email_login_attempts WHERE email_key = ?1 AND issued_at > ?2 - 60
          ORDER BY issued_at DESC LIMIT 1) AS recent,
         EXISTS (SELECT 1 FROM email_login_attempts WHERE issued_at <= ?2 - 3600) AS needs_prune
`;

// Admission and quota reservation are one SQLite write, including under concurrent sends.
const reserve = `
  INSERT INTO email_login_attempts (challenge_key, code_mac, email_key, ip_key, issued_at, active)
  SELECT ?1, ?2, ?3, ?4, ?5, 1
  WHERE NOT EXISTS (SELECT 1 FROM email_login_attempts WHERE email_key = ?3 AND issued_at > ?5 - 60)
    AND NOT EXISTS (SELECT 1 FROM email_login_attempts WHERE email_key = ?3 AND issued_at > ?5 - 3600 LIMIT 1 OFFSET 4)
    AND NOT EXISTS (SELECT 1 FROM email_login_attempts WHERE ip_key = ?4 AND issued_at > ?5 - 3600 LIMIT 1 OFFSET 19)
    AND NOT EXISTS (SELECT 1 FROM email_login_attempts WHERE issued_at > ?5 - 3600 LIMIT 1 OFFSET 299)
`;

// Only denied requests need the next release time for the overlapping windows.
const nextAdmission = `
  SELECT max(
    1,
    coalesce((SELECT max(issued_at) + 60 - ?3 FROM email_login_attempts WHERE email_key = ?1), 0),
    coalesce((SELECT issued_at + 3600 - ?3 FROM email_login_attempts WHERE email_key = ?1 ORDER BY issued_at DESC LIMIT 1 OFFSET 4), 0),
    coalesce((SELECT issued_at + 3600 - ?3 FROM email_login_attempts WHERE ip_key = ?2 ORDER BY issued_at DESC LIMIT 1 OFFSET 19), 0),
    coalesce((SELECT issued_at + 3600 - ?3 FROM email_login_attempts ORDER BY issued_at DESC LIMIT 1 OFFSET 299), 0)
  ) AS seconds
`;

function failure(error, status, retrySeconds) {
  const result = json({ error }, status);
  if (retrySeconds) result.headers.set('Retry-After', String(retrySeconds));
  return result;
}

// Per-isolate negative cache for confirmed daily D1 failures. Probe again within a
// minute in case billing changes, and immediately when the UTC allowance resets.
const dailyProbeAt = new WeakMap();

function databaseCategory(error) {
  const message = [error?.message, error?.cause?.message, error?.cause?.cause?.message].join(' ');
  const daily = /\b(?:daily|per day|in a day|today|midnight)\b/i.test(message);
  if (daily && /\b(?:quotas?|limits?|allowance|maximum)\b/i.test(message)) return 'daily_quota';
  return /\b(?:quotas?|free tier)\b/i.test(message) ? 'quota' : 'database';
}

function rememberDailyFailure(db, now) {
  dailyProbeAt.set(db, now + Math.min(60, 86400 - now % 86400));
}

function dailyFailure(now) {
  const untilReset = 86400 - now % 86400;
  const result = failure('store_daily_limit', 503, untilReset);
  result.headers.set('Date', new Date(now * 1000).toUTCString());
  return result;
}

async function cooldown(db, emailKey, ipKey, now, minimumWait) {
  let wait = minimumWait;
  try {
    const until = await db.prepare(nextAdmission).bind(emailKey, ipKey, now).first();
    if (Number.isInteger(until?.seconds) && until.seconds > 0) wait = Math.max(wait || 0, until.seconds);
  } catch (error) {
    const category = databaseCategory(error);
    if (category === 'daily_quota') rememberDailyFailure(db, Math.floor(Date.now() / 1000));
    console.warn('email_auth_start', { stage: 'retry_after', category });
  }
  return failure('rate_limited', 429, wait);
}

function responseDelay(response) {
  const value = response.headers.get('Retry-After');
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.min(Number(value), 86400) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 86400000)) : null;
}

async function submitMail(env, message, deliveryKey) {
  const headers = {
    Authorization: 'Bearer ' + env.RESEND_API_KEY,
    'Content-Type': 'application/json',
    'Idempotency-Key': deliveryKey,
  };
  // Two 9s attempts and a delay of at most 2s leave room for D1 within the UI's 35s timeout.
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let delay = 250;
    let category;
    let status;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers, body: message, signal: controller.signal, redirect: 'manual',
      });
      status = response.status;
      // Resend's HTTP acceptance completes the handoff. The sign-in flow does
      // not use its message ID and must not lose the challenge reading a body.
      if (response.ok) return null;
      const data = await response.json().catch(() => null);
      delay = responseDelay(response) ?? (status === 429 ? 1000 : 250);
      if ((status === 429 && ['daily_quota_exceeded', 'monthly_quota_exceeded'].includes(data?.name))
        || (status === 403 && data?.name === 'email_above_quota')) category = 'quota';
      else if (status === 429) category = 'rate_limit';
      else if (status === 409 && data?.name === 'concurrent_idempotent_requests') category = 'in_progress';
      else if (status === 408 || status >= 500) category = 'temporary';
      else category = 'rejected';
    } catch {
      category = controller.signal.aborted ? 'timeout' : 'transport';
    } finally {
      clearTimeout(timer);
    }
    console.warn('email_auth_start', { stage: 'resend', attempt, ...(status ? { status } : {}), category });
    if (category === 'quota') return failure('delivery_quota', 503);
    if (category === 'rejected') return failure('delivery_unavailable', 503);
    if (attempt === 2 || delay > 2000) {
      const uncertain = category === 'timeout' || category === 'transport' || category === 'in_progress';
      return failure(uncertain ? 'delivery_unconfirmed' : 'delivery_busy', 503, Math.max(60, Math.ceil(delay / 1000)));
    }
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  }
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
  const db = env.DVN_AUTH_DB;
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
    if (dailyProbeAt.get(db) > now) return dailyFailure(now);
    const [challengeKey, codeMac, emailKey, ipKey, pending] = await Promise.all([
      mac(secret, 'challenge', challenge), mac(secret, 'code', challenge + ':' + code),
      mac(secret, 'email', email.toLowerCase()), mac(secret, 'ip', request.headers.get('CF-Connecting-IP') || 'unknown'),
      seal(claims, secret + ':email-challenge-v1'),
    ]);
    // Prepare the browser response before sending. Only a confirmed provider
    // acceptance releases this cookie, which is required to use the active row.
    const accepted = json({ sent: true }, 202);
    setCookie(accepted, challengeCookie, pending, lifetime);
    stage = 'reserve';
    let check;
    try {
      check = await db.prepare(preflight).bind(emailKey, now).first();
    } catch (error) {
      // A positively identified daily outage affects reservation too; do not retry D1.
      if (databaseCategory(error) === 'daily_quota') throw error;
      // For other read failures, the atomic reservation still enforces all limits.
    }
    if (check?.recent != null) return await cooldown(db, emailKey, ipKey, now, check.recent + 60 - now);
    const statements = [];
    if (check?.needs_prune !== 0) {
      statements.push(db.prepare('DELETE FROM email_login_attempts WHERE issued_at <= ?').bind(now - 3600));
    }
    statements.push(db.prepare(reserve).bind(challengeKey, codeMac, emailKey, ipKey, now));
    const results = await db.batch(statements);
    const failed = results?.find(result => result?.success === false && result.error);
    if (failed) throw Error(failed.error);
    const admission = results?.at(-1);
    if (results?.length !== statements.length || results.some(result => !result || result.success === false) || ![0, 1].includes(admission?.meta?.changes)) {
      console.warn('email_auth_start', { stage, category: 'unconfirmed_write' });
      return failure('reservation_unconfirmed', 503);
    }
    if (admission.meta.changes === 0) return await cooldown(db, emailKey, ipKey, now);
    stage = 'resend';
    const message = JSON.stringify({
      from: 'DVN CLOTHING <account@dvnclothing.com>',
      to: [email],
      ...signInMessage(code, payload.language ?? payload.lang, lifetime),
    });
    const deliveryFailure = await submitMail(env, message, 'dvn-login-' + challengeKey);
    return deliveryFailure ?? accepted;
  } catch (error) {
    const category = stage === 'reserve' ? databaseCategory(error) : 'internal';
    console.warn('email_auth_start', { stage, category });
    if (category === 'daily_quota') {
      const observedAt = Math.floor(Date.now() / 1000);
      rememberDailyFailure(db, observedAt);
      return dailyFailure(observedAt);
    }
    if (category === 'quota') return failure('store_quota', 503);
    return failure(stage === 'reserve' ? 'store_unavailable' : 'unavailable', 503);
  }
}
