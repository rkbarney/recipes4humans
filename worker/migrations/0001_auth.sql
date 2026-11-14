-- Accounts and sign-in sessions (Version 2, task 10).

CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- our own random id
  google_sub TEXT NOT NULL UNIQUE,  -- Google's stable account id ("sub" in the ID token)
  email TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  created INTEGER NOT NULL,         -- ms since epoch
  last_login INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,      -- SHA-256 hex of the cookie value; the value itself is never stored
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions(user_id);
