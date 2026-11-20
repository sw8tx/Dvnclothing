CREATE TABLE IF NOT EXISTS email_login_attempts (
  challenge_key TEXT PRIMARY KEY,
  code_mac TEXT NOT NULL,
  email_key TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  tries INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS email_login_by_address ON email_login_attempts(email_key, issued_at);
CREATE INDEX IF NOT EXISTS email_login_by_ip ON email_login_attempts(ip_key, issued_at);
CREATE INDEX IF NOT EXISTS email_login_by_time ON email_login_attempts(issued_at);
