import { noStore, origin } from '../auth/_lib.js';
import { identity } from '../auth/_profile.js';
import { body } from '../auth/email/_shared.js';
import { onRequestGet as currentBonus } from './bonus.js';
import { bonusMessage } from './_bonus-message.js';

const reply = (value, status = 200) => noStore(Response.json(value, { status }));
const unavailable = () => reply({ error: 'unavailable' }, 503);

// Retain the exact first request for idempotent retry, even across app updates.
// Stop ambiguous retries before Resend's 24-hour idempotency window expires.
const reserve = `INSERT INTO welcome_bonus_mail
  (code, delivery_key, pending_message, started_at, lease_until)
  VALUES (?1, ?2, ?3, ?4, ?4 + 20)
  ON CONFLICT(code) DO UPDATE SET lease_until = excluded.lease_until
  WHERE sent_at IS NULL AND lease_until <= ?4 AND started_at > ?4 - 82800`;

export async function onRequestPost(context) {
  const { env, request } = context;
  const site = origin(request);
  if (!site || site !== new URL(request.url).origin || site !== request.headers.get('Origin')) {
    return reply({ error: 'invalid_origin' }, 403);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply({ error: 'invalid' }, 400);
  }
  const payload = await body(request);
  if (!payload || !['de', 'en'].includes(payload.language)) return reply({ error: 'invalid' }, 400);
  try {
    const user = await identity(request, env);
    if (!user) return reply({ error: 'unauthenticated' }, 401);
    const lookup = await currentBonus(context);
    if (!lookup.ok) return lookup;
    const { bonus } = await lookup.json();
    if (!bonus) return reply({ error: 'bonus_unclaimed' }, 409);
    const db = env.DVN_AUTH_DB;
    const now = Math.floor(Date.now() / 1000);
    // Remove expired recipient and rendered content in bounded batches; retain the
    // receipt row to prevent an uncertain delivery from being sent a second time.
    await db.prepare(`UPDATE welcome_bonus_mail SET pending_message = NULL WHERE code IN
      (SELECT code FROM welcome_bonus_mail WHERE pending_message IS NOT NULL AND started_at <= ?
       ORDER BY started_at LIMIT 64)`).bind(now - 82800).run();
    const sent = async () => Boolean((await db.prepare('SELECT sent_at FROM welcome_bonus_mail WHERE code = ?').bind(bonus.code).first())?.sent_at);
    if (await sent()) return reply({ sent: true });
    if (!env.RESEND_API_KEY) return unavailable();
    const message = JSON.stringify({
      from: 'DVN CLOTHING <account@dvnclothing.com>', to: [user.email],
      ...bonusMessage(bonus.code, bonus.percentOff, payload.language),
    });
    const [acquired, leased] = await db.batch([
      db.prepare(reserve).bind(bonus.code, crypto.randomUUID(), message, now),
      db.prepare('SELECT delivery_key, pending_message FROM welcome_bonus_mail WHERE code = ?')
        .bind(bonus.code),
    ]);
    if (acquired.meta?.changes !== 1) return await sent() ? reply({ sent: true }) : unavailable();
    const delivery = leased.results?.[0];
    if (!delivery?.pending_message || !delivery.delivery_key) return unavailable();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(7000),
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'dvn-bonus-' + delivery.delivery_key },
      body: delivery.pending_message,
    });
    if (!response.ok) return unavailable();
    const receipt = await db.prepare('UPDATE welcome_bonus_mail SET sent_at = ?, pending_message = NULL WHERE delivery_key = ? AND sent_at IS NULL')
      .bind(now, delivery.delivery_key).run();
    if (receipt.meta?.changes !== 1 && !(await sent())) return unavailable();
    return reply({ sent: true });
  } catch {
    return unavailable();
  }
}
