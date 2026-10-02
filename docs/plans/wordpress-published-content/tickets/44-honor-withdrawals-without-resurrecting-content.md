## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

When the Frontend receives a valid WordPress unpublish/delete event, visitors immediately stop receiving that publication, even if the CMS is then offline. Duplicate, delayed and racing work cannot resurrect withdrawn content, and an explicitly newer authorized republication can become public again.

The accepted guarantee begins when a valid withdrawal reaches the Frontend. If both the CMS and event delivery are unavailable, the Frontend cannot infer an unseen withdrawal; unlimited last-known-good serving retains that explicitly accepted limitation. Missed withdrawals are subsequently covered by reconciliation.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] Drive unpublish and delete transitions through the compatible CMS event path and verify the affected public URI returns 404 after the withdrawal has been accepted, including when CMS reads are unavailable.
- [ ] Withdraw using authenticated event authority and durable publication identity rather than requiring a subsequent successful CMS read before removing the cached publication.
- [ ] Withdrawal state survives restart/redeploy and takes precedence over stale fallback, delayed publish events, duplicate deliveries and an in-flight older refresh.
- [ ] Test ordering across publication, withdrawal and a genuinely newer republication; an old event never restores content, while an explicitly newer legitimate publication can refresh normally.
- [ ] Exercise the actual storage/runtime consistency path so a cached edge or alternate read path cannot bypass accepted withdrawal state; document the guarantee rather than assuming eventually propagated invalidation is immediate.
- [ ] Reject unauthenticated/wrong-Site withdrawal attempts without changing another Site's publication. Keep private editorial content out of public state and logs.
- [ ] Cover changed-URI cleanup where the predecessor must no longer present superseded content, and preserve unaffected publications during withdrawal.
- [ ] Add rendered-route race, replay and outage tests using controllable delivery timing, and run applicable CMS/Frontend/runtime checks.

## Blocked by

- #43: Refresh publications through authenticated WordPress events
