-- Reconciliation (ADR 0009): the CMS's scheduler asks the Frontend, every
-- minute, to compare its publication store with what WordPress publishes and
-- to refresh what differs, so a change whose event never arrived still
-- reaches visitors. Added for it, and harmless to the Worker version before:
-- it never names these columns or this table.

-- When WordPress last modified the entry a row holds (ms since the epoch, the
-- CMS's clock: WPGraphQL's modifiedGmt), as the read that promoted it saw it.
-- NULL for rows promoted before this column, or by a read without it: a
-- reconciliation reads those again.
ALTER TABLE publications ADD COLUMN modified_at INTEGER;

-- The Site's reconciliation: one row, holding the lease that keeps two runs
-- from overlapping and the outcome of the last run, for diagnostics.
CREATE TABLE reconciliation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- The run holding the lease (the reconcile event's id), and until when (ms).
  -- A run that was interrupted leaves it to expire.
  run_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  -- "reconciled" (nothing differs any more), "behind" (changes left for the
  -- next run) or "failed" (a read or a refresh failed; what was stored is
  -- kept).
  outcome TEXT,
  -- What the last run found: the published entries it compared, the changes it
  -- refreshed, those it left for the next run, and those whose refresh failed.
  checked INTEGER,
  changed INTEGER,
  pending INTEGER,
  failed INTEGER,
  -- The first failure's reason and message (no content, no secret).
  reason TEXT,
  message TEXT,
  -- When the last run that left nothing behind started: the store matched
  -- WordPress as of then.
  reconciled_at INTEGER
);

-- Reconciliation records the change it found in an entry, when WordPress
-- gives its id and modification time, as a publication event in
-- publication_events (an id starting "reconcile-", the same for the same
-- change, and occurred_at its modification time), so it is processed, ordered
-- and retried by the same rules as one the CMS sent.
