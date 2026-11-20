-- Null falls back to the identity provider's current value.
-- An empty avatar explicitly hides the provider photo.
CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 64),
  avatar TEXT CHECK (avatar IS NULL OR length(avatar) <= 174800)
);
