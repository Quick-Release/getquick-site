## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

Visitors can browse the supported published pages and posts from durable state, including their required shared settings, when the CMS is unavailable. Explicit refresh/preparation handles a new publication, a moved URI and confirmed absence without confusing a cache miss with a missing page.

This ticket extends the trusted refresh path established by the homepage slice. It does not yet require automatic CMS events or implement unrelated archives, custom post types, previews, renderer reconstruction or nested-menu presentation.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] Explicitly populate and refresh supported published page/post URIs, then render homepage and entries with their required menu, logo, identity and design data through a disposable generated Frontend.
- [ ] Normal cached entry reads do not fetch the CMS synchronously; cached entries and chrome survive CMS outages without a fixed-age limit.
- [ ] Successful new-publication refresh makes the new route available. Refreshing a changed URI reconciles the previous route rather than continuing to present its superseded cached publication as current.
- [ ] Confirmed missing content returns 404. An uncached URI during CMS or storage unavailability returns 503; an empty store is not evidence of absence. Define and test the healthy cold-cache lookup/preparation path explicitly.
- [ ] Partial entry or shared-data refresh failures do not overwrite usable publications or erase chrome. Accepted replacement state is compatible with the supported renderer.
- [ ] Drafts, revisions, private/password-protected editorial content and visitor-specific responses are excluded from the public representation.
- [ ] Persisted route identity and state are sufficient for later publication ordering and withdrawal handling; entries remain isolated by Site.
- [ ] Add rendered-route acceptance tests for outage, cold-cache status, new and moved publications, failed refresh and shared-data preservation; run applicable existing checks.

## Blocked by

- #41: Serve a durable last-known-good homepage
