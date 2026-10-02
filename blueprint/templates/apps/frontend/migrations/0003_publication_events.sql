-- The CMS's publication events (POST /gq/events): one row per event the
-- Frontend accepted, so a duplicate is recognised, a delayed one can't undo a
-- newer one, and one whose refresh failed stays on record for a retry. Added
-- for them, and harmless to the Worker version before: it never reads it.

CREATE TABLE publication_events (
  -- The event's identity, chosen by the CMS (a UUID). A delivery of an id
  -- already recorded is a duplicate, or a retry of one that failed.
  id TEXT PRIMARY KEY,
  -- What happened: "publish" (a page or post was published or updated).
  action TEXT NOT NULL,
  -- The WordPress entry it is about (WPGraphQL's global id), as in
  -- publications.node_id.
  node_id TEXT NOT NULL,
  -- The entry's URI when the event happened, and the one it had before, if it
  -- moved.
  uri TEXT NOT NULL,
  previous_uri TEXT,
  -- When it happened in the CMS (ms since the epoch): the order of one
  -- entry's events. An event older than one already refreshed for the same
  -- entry is superseded, never processed.
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  -- "received" (not processed yet, or interrupted), "refreshed", "failed"
  -- (its refresh kept the stored versions; a retry may process it again) or
  -- "superseded" (a newer event for the entry was refreshed).
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at INTEGER,
  -- Why it failed, when it did (a refresh failure reason and its message).
  reason TEXT,
  message TEXT
);

CREATE INDEX publication_events_node ON publication_events (node_id, occurred_at);
CREATE INDEX publication_events_status ON publication_events (status, received_at);
