CREATE TABLE IF NOT EXISTS welcome_bonuses (
  email_key TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL UNIQUE,
  retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1)),
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  stripe_test_customer_id TEXT UNIQUE,
  stripe_test_promotion_id TEXT UNIQUE,
  CHECK ((stripe_test_customer_id IS NULL) = (stripe_test_promotion_id IS NULL))
);
