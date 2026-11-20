import { sameLinkMailbox } from './email/_shared.js';

export async function linkAccounts(env, emailUser, googleUser) {
  if (emailUser?.provider !== 'email' || googleUser?.provider !== 'google') return false;
  if (!sameLinkMailbox(emailUser.email, googleUser.email)) return false;
  // Refuse implicit replacement of an existing binding or incompatible custom
  // profile fields. Both checks and the INSERT share a single SQLite statement.
  const joined = await env.DVN_AUTH_DB.prepare(`
    INSERT INTO account_links (google_id, email_id, default_name, default_picture)
    SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (
      SELECT 1 FROM user_profiles g, user_profiles e
      WHERE g.id = ?1 AND e.id = ?2 AND
        (g.name <> e.name OR g.avatar <> e.avatar))
    ON CONFLICT DO NOTHING
  `).bind(googleUser.id, emailUser.id, googleUser.name.slice(0, 128), googleUser.picture).run();
  if (joined.meta?.changes === 1) return true;
  const existing = await env.DVN_AUTH_DB.prepare(
    'SELECT email_id FROM account_links WHERE google_id = ? AND email_id = ?'
  ).bind(googleUser.id, emailUser.id).first();
  return Boolean(existing);
}
