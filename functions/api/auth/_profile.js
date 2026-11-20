import { cookie, unseal } from './_lib.js';

export function profileConfigured(env) {
  return Boolean(env.AUTH_COOKIE_SECRET?.length >= 32 && env.DVN_AUTH_DB?.prepare);
}

export function googlePicture(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.hostname.endsWith('.googleusercontent.com') && url.href.length <= 2048 ? url.href : '';
  } catch {
    return '';
  }
}

export async function rawIdentity(request, env) {
  if (!(env.AUTH_COOKIE_SECRET?.length >= 32)) return null;
  const claims = await unseal(cookie(request, '__Host-dvn-session'), env.AUTH_COOKIE_SECRET);
  return identityFromClaims(claims);
}

export const identity = rawIdentity;

export async function identityFromClaims(claims) {
  if (!claims || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 320 ||
      typeof claims.email !== 'string' || !claims.email || claims.email.length > 254) return null;
  const email = claims.email.trim();
  const emailIdentity = claims.sub.startsWith('email:');
  if (emailIdentity && claims.sub !== 'email:' + email) return null;
  const provider = emailIdentity ? 'email' : 'google';
  const subject = emailIdentity ? claims.sub : 'google:' + claims.sub;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return {
    id, provider, email,
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email,
    picture: emailIdentity ? '' : googlePicture(claims.picture),
  };
}

export async function readProfile(user, env) {
  const own = { ...user, linkedProviders: [user.provider], cartAliases: [] };
  if (!profileConfigured(env)) return own;
  const row = await env.DVN_AUTH_DB.prepare(`
    SELECT link.email_id, link.google_id,
      COALESCE(primary_profile.name, other_profile.name, link.default_name) AS name,
      COALESCE(primary_profile.avatar, other_profile.avatar, link.default_picture) AS picture
    FROM (SELECT ? AS raw_id) AS key
    LEFT JOIN account_links link ON link.google_id = key.raw_id OR link.email_id = key.raw_id
    LEFT JOIN user_profiles primary_profile ON primary_profile.id = COALESCE(link.email_id, key.raw_id)
    LEFT JOIN user_profiles other_profile ON other_profile.id = link.google_id
  `).bind(user.id).first();
  return {
    ...own, id: row?.email_id ?? user.id, name: row?.name ?? user.name,
    picture: row?.picture ?? user.picture,
    linkedProviders: row?.google_id ? ['email', 'google'] : own.linkedProviders,
    cartAliases: row?.google_id ? [row.google_id] : [],
  };
}

export async function saveProfile(user, changes, env) {
  // Resolve the canonical account and write in one statement, even if linking
  // and editing from two tabs happen concurrently.
  await env.DVN_AUTH_DB.prepare(
    `INSERT INTO user_profiles (id, name, avatar)
     VALUES (COALESCE((SELECT email_id FROM account_links WHERE google_id = ?1), ?1), ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET
       name = COALESCE(excluded.name, user_profiles.name),
       avatar = COALESCE(excluded.avatar, user_profiles.avatar)`
  ).bind(user.id, changes.name ?? null, changes.avatar ?? null).run();
  return readProfile(user, env);
}
