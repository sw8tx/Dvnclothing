-- The immutable first request fixes the recipient, language and delivery key for retries.
CREATE TABLE IF NOT EXISTS welcome_bonus_mail (
  code TEXT PRIMARY KEY NOT NULL REFERENCES welcome_bonuses(code),
  delivery_key TEXT NOT NULL UNIQUE,
  pending_message TEXT,
  started_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS welcome_bonus_mail_pending ON welcome_bonus_mail(started_at) WHERE pending_message IS NOT NULL;
