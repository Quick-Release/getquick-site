-- Published entries (pages and posts), one row each in publications, keyed
-- "entry:<uri>". Added for them, and harmless to the Worker version before:
-- it never names node_id, so its writes leave it NULL.

-- Which WordPress post or page a row holds (WPGraphQL's global id), so a
-- refresh that finds it at another URI can reconcile the route it left, and
-- a later withdrawal can find every route that served it.
ALTER TABLE publications ADD COLUMN node_id TEXT;

CREATE INDEX publications_node_id ON publications (node_id);

-- publications.state gains "moved": the entry the row held is published at
-- another URI now (body: {"uri": "<its URI>"}), so the route redirects there
-- instead of presenting its superseded copy as current.
