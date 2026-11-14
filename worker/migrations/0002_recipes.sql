-- Synced recipe library (Version 2, task 11).

-- Per-user change counter. Every accepted change gets the next number, so a device can ask for
-- "everything after N" without trusting any phone's clock.
ALTER TABLE users ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE recipes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,                 -- the app's recipe id
  body TEXT,                        -- the recipe record as JSON; NULL once deleted
  updated INTEGER NOT NULL,         -- the device's edit time (ms); newer wins
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,             -- users.seq when this row last changed
  PRIMARY KEY (user_id, id)
);

CREATE INDEX recipes_user_seq ON recipes(user_id, seq);
