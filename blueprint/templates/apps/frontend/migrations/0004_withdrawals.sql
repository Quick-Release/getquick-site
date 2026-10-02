-- The CMS's withdrawals (a page or post unpublished, made private or
-- password-protected, trashed or deleted): one row per WordPress entry whose
-- last accepted lifecycle event withdrew it. While a withdrawal is in force,
-- nothing promotes that entry's content again, whatever a read returns; only a
-- publication event that happened after it lifts it. Added for them, and
-- harmless to the Worker version before: it never reads this table, and a
-- "withdrawn" row is a state it doesn't know, so it serves it as a 503, never
-- as content.

CREATE TABLE withdrawals (
  -- The WordPress entry (WPGraphQL's global id), as in publications.node_id.
  node_id TEXT PRIMARY KEY,
  -- The withdraw event in force (publication_events.id) and the URI the entry
  -- had while it was published.
  event_id TEXT NOT NULL,
  uri TEXT NOT NULL,
  -- When it happened in the CMS (ms since the epoch), and when the Frontend
  -- accepted it (ms, the Frontend's clock).
  withdrawn_at INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  -- The newer publication event that lifted it, and when that happened in the
  -- CMS. NULL while the withdrawal is in force.
  republished_by TEXT,
  republished_at INTEGER
);

-- publications.state gains "withdrawn": the entry the row held was withdrawn
-- (body NULL). It is a 404, and nothing older than the withdrawal replaces it.
-- publication_events.action gains "withdraw"; one that was applied is
-- recorded "refreshed", like a publication: the store is up to date with it.
