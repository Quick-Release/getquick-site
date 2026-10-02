## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

A visitor to a new content Site sees an honest missing-content or temporary-unavailability response instead of a CMS failure disguised as a 404. Deepen the existing CMS delivery module so home, entries and site chrome expose validated outcomes that later refresh slices can safely consume. This is the prefactor: preserve behaviour that is genuinely supported while concentrating failure meaning before adding persistence.

This ticket establishes failure semantics, not durable caching. Prefer the existing delivery and public-rendering seams; a pass-through fetch helper alone does not deliver the feature. It can start immediately and does not depend on independent-media work.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] Through a disposable generated Site's rendered Frontend, a confirmed missing published entry returns 404, while CMS timeout, HTTP failure or invalid required schema returns 503 rather than 404.
- [ ] Production homepage failure is not a successful development placeholder; friendly local no-CMS development remains available.
- [ ] HTTP errors, GraphQL errors, missing required fields and genuinely absent content remain distinguishable through the delivery module. A failed chrome read is not normalized into a successful empty replacement.
- [ ] Required GETQUICK schema is validated; declared optional fallbacks cannot silently conceal incompatible required fields. Preserve usable publication outcomes without treating partial failure as deletion.
- [ ] Existing narrow block recovery is assessed consistently for home and entries; timeouts and failed recovery do not become confirmed absence.
- [ ] Add generated-route acceptance coverage for these outcomes and run the existing Frontend tests and repository checks. Replace obsolete timeout-to-null assertions only after equivalent observable coverage exists.
- [ ] Keep generation offline and secret-free, preserve existing site-owned applications, and avoid unrelated renderer, menu-presentation or public-link fixes.

## Blocked by

None (can start immediately).
