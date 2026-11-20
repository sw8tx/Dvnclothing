import { noStore, origin } from '../auth/_lib.js';
import { identity } from '../auth/_profile.js';
import { prepareTestPromotion, retireTestPromotion } from './_stripe.js';

// An address limits issuance. Only the sign-in subject or an explicitly proven link grants access.
const viewer = `WITH viewer(email_key, id) AS (VALUES (?, ?)), owners(id) AS (
  SELECT id FROM viewer
  UNION SELECT google_id FROM account_links JOIN viewer ON email_id = viewer.id
  UNION SELECT email_id FROM account_links JOIN viewer ON google_id = viewer.id
)`;
const authorized = 'owner_id IN (SELECT id FROM owners)';
const candidates = `${authorized} OR email_key = (SELECT email_key FROM viewer)`;
const read = `${viewer} SELECT CASE WHEN retired = 0 AND ${authorized} THEN code END AS code, stripe_test_promotion_id
  FROM welcome_bonuses WHERE ${candidates}
  ORDER BY (retired = 0 AND ${authorized}) DESC, created_at, code LIMIT 1`;
const issue = `${viewer} INSERT INTO welcome_bonuses (email_key, owner_id, code)
  SELECT email_key, id, ? FROM viewer WHERE NOT EXISTS
  (SELECT 1 FROM welcome_bonuses WHERE ${candidates}) ON CONFLICT DO NOTHING`;
const retireDuplicates = `${viewer} UPDATE welcome_bonuses SET retired = 1
  WHERE ${authorized} AND retired = 0 AND code <> (
    SELECT code FROM welcome_bonuses WHERE ${authorized} AND retired = 0 ORDER BY created_at, code LIMIT 1
  )`;
const retiredCodes = `${viewer} SELECT code FROM welcome_bonuses WHERE retired = 1 AND ${authorized}`;

function reply(value, status = 200) {
  return noStore(Response.json(value, { status }));
}

function generateCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const random = crypto.getRandomValues(new Uint8Array(20));
  const letters = Array.from(random, (byte) => alphabet[byte & 31]).join('');
  return 'DVN-' + letters.match(/.{4}/g).join('-');
}

async function accountKey(email) {
  // Dedupe survives session-key rotation and never grants read access.
  const bytes = new TextEncoder().encode('dvn-welcome-v1:' + email.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function handle(context, claim) {
  const { request, env } = context;
  if (claim) {
    const site = origin(request);
    if (!site || site !== new URL(request.url).origin || site !== request.headers.get('Origin')) {
      return reply({ error: 'invalid_origin' }, 403);
    }
  }
  const user = await identity(request, env);
  if (!user) return reply({ error: 'unauthenticated' }, 401);
  const db = env.DVN_AUTH_DB;
  if (!db?.prepare) return reply({ error: 'bonus_unavailable' }, 503);

  try {
    const key = await accountKey(user.email);
    const query = (sql) => db.prepare(sql).bind(key, user.id);
    let row;
    let retired = [];
    if (claim) {
      const results = await db.batch([
        db.prepare(issue).bind(key, user.id, generateCode()),
        query(retireDuplicates), query(read), query(retiredCodes),
      ]);
      row = results[2].results[0];
      retired = results[3].results;
    } else {
      row = await query(read).first();
    }

    if (row && !row.code) return reply({ error: 'account_link_required' }, 409);
    if (claim && !row) throw Error('Bonus claim unavailable');
    if (claim && env.STRIPE_TEST_SECRET_KEY) {
      const tasks = retired.map(({ code }) => retireTestPromotion(env, code));
      if (!row.stripe_test_promotion_id) tasks.push(prepareTestPromotion(env, row.code));
      const work = Promise.all(tasks).catch(() => {
        // D1 remains authoritative. Another authenticated POST retries sandbox synchronization.
        console.warn('DVN welcome bonus sandbox provisioning pending');
      });
      if (context.waitUntil) context.waitUntil(work);
      else await work;
    }
    return reply({ bonus: row ? { code: row.code, percentOff: 15, firstOrderOnly: true } : null });
  } catch {
    return reply({ error: 'bonus_unavailable' }, 503);
  }
}

export const onRequestGet = (context) => handle(context, false);
export const onRequestPost = (context) => handle(context, true);
