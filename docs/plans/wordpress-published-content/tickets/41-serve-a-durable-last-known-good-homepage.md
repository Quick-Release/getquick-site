## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

After an explicit trusted preparation/refresh operation, a new content Site serves its published homepage and required shared chrome from durable last-known-good state. Visitors retain that homepage throughout CMS outages and Worker restarts. This narrow runtime tracer bullet proves the actual pinned Astro/Alchemy/Cloudflare storage path before extending it to every published route or automatic WordPress events.

Automatic event delivery, all-entry routing and reconciliation are later slices. The trusted operation must not be an unauthenticated public mutation endpoint. Coordinate existing shared WordPress client/renderer ownership without resolving or replacing the shared-package decision.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] Generate a disposable content Site, successfully read a published WordPress front page plus required shared data, explicitly populate its durable public representation, and render it through the actual Frontend runtime adapter.
- [ ] Normal cached homepage requests use the stored representation rather than synchronously reading the CMS on every visit.
- [ ] Make the CMS unavailable and advance time beyond ordinary cache expiry; the last successful homepage, menu/logo data and required design data remain available without an outage-age limit.
- [ ] A refresh with transport, GraphQL or required-data failure preserves the previous good representation and emits safe diagnostics; a failed chrome read does not blank the cached homepage.
- [ ] The representation survives Worker restart and routine redeploy. Cold/unusable state yields an honest not-ready or 503 outcome, never a misleading 404 or production placeholder.
- [ ] Verify runtime bindings, storage access and any trusted refresh authority against the pinned Alchemy/Astro/Cloudflare integration; a type check or deploy-time environment variable alone is insufficient evidence.
- [ ] Choose and record durable storage, publication promotion and persisted-state evolution mechanisms that can support later withdrawal precedence and ordering; do not assume best-effort edge invalidation satisfies those guarantees.
- [ ] Separate Sites' stored content and authority, exclude private/draft data, preserve offline generation and site-owned applications, and add rendered homepage outage/restart acceptance tests plus a real runtime build/serve proof.

## Blocked by

- #39: Distinguish missing content from CMS failures
