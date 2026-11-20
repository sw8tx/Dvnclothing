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

export async function identity(request, env) {
  if (!(env.AUTH_COOKIE_SECRET?.length >= 32)) return null;
  const claims = await unseal(cookie(request, '__Host-dvn-session'), env.AUTH_COOKIE_SECRET);
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

export function withOverrides(user, row) {
  return { ...user, name: row?.name ?? user.name, picture: row?.avatar ?? user.picture };
}

export async function readProfile(user, env) {
  if (!profileConfigured(env)) return user;
  const row = await env.DVN_AUTH_DB.prepare('SELECT name, avatar FROM user_profiles WHERE id = ?')
    .bind(user.id).first();
  return withOverrides(user, row);
}

export async function saveProfile(user, changes, env) {
  // Merge only the explicitly supplied fields in one write, including the
  // returned snapshot, so a stale tab cannot undo a concurrent avatar update.
  const row = await env.DVN_AUTH_DB.prepare(
    `INSERT INTO user_profiles (id, name, avatar) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = COALESCE(excluded.name, user_profiles.name),
       avatar = COALESCE(excluded.avatar, user_profiles.avatar)
     RETURNING name, avatar`
  ).bind(user.id, changes.name ?? null, changes.avatar ?? null).first();
  return withOverrides(user, row);
}
