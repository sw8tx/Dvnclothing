-- A row is written only after an explicit linking action proves both sign-in methods.
CREATE TABLE IF NOT EXISTS account_links (
  google_id TEXT NOT NULL PRIMARY KEY,
  email_id TEXT NOT NULL UNIQUE,
  default_name TEXT NOT NULL,
  default_picture TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (google_id <> email_id)
);
