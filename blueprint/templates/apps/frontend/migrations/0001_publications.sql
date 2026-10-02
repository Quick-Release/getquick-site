-- The Frontend's durable published content: the last-known-good public
-- representation of each published thing ("home", "chrome"), and the outcome
-- of the last refresh of each. Alchemy applies these files in order on deploy
-- (infra/frontend.run.ts), before the Worker is updated, so a migration must
-- keep working with the Worker version it replaces: add, never rewrite.

CREATE TABLE publications (
  -- What the row is: "home" (the front page), "chrome" (menu, logo, icon).
  key TEXT PRIMARY KEY,
  -- "published" (body holds it) or "missing" (the CMS confirmed nothing is
  -- published there).
  state TEXT NOT NULL,
  -- The version of body's shape. A Worker only serves the formats it knows.
  format INTEGER NOT NULL,
  body TEXT,
  -- When the CMS read behind this row started (ms since the epoch). A
  -- promotion only replaces a row whose read started earlier, so a slow or
  -- delayed refresh can't overwrite a newer one.
  read_started_at INTEGER NOT NULL,
  promoted_at INTEGER NOT NULL
);

CREATE TABLE refresh_attempts (
  key TEXT PRIMARY KEY,
  attempted_at INTEGER NOT NULL,
  -- "promoted", "superseded" (a newer read was already promoted) or "kept"
  -- (the read failed, so the stored row was left as it was).
  outcome TEXT NOT NULL,
  reason TEXT,
  message TEXT
);
