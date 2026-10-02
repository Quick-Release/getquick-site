## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

Even when a WordPress publication, withdrawal or shared-setting notification is missed, the public Frontend converges to the CMS within the agreed five-minute target window while dependencies are healthy. This happens without visitors; outages preserve good content and accepted withdrawals remain authoritative during recovery.

The five-minute target applies while CMS and refresh dependencies are healthy; it is not a promise through scheduler outages or arbitrary overload. This slice genuinely needs withdrawal semantics, shared-setting change detection and durable recovery execution, so all three are blockers.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] Establish periodic reconciliation on a verified scheduler independent of visitor traffic and traffic-driven WordPress cron.
- [ ] Detect changes to supported published pages/posts, route identity, withdrawals and menus/logo/identity/design presets; do not rely solely on entry modification timestamps.
- [ ] Under controlled healthy conditions, drop each event kind and verify the corresponding rendered public change appears within five minutes of the CMS change, with no visitor-triggered refresh or manual republishing.
- [ ] With CMS reads or refresh execution unavailable, preserve last-known-good publications and shared data without an age limit; failures do not create false withdrawals or blank the website.
- [ ] After dependencies recover, safely reconcile missed changes through the same validated promotion, ordering and withdrawal rules as event delivery. Accepted withdrawals cannot be undone by an older scan or in-flight work.
- [ ] Make interrupted/repeated scans recoverable and Site-isolated, reuse durable retry/diagnostic execution where appropriate, and avoid duplicate destructive side effects.
- [ ] Exercise multiple pages and shared changes, document the observed target-window behaviour and failure limitations, and retain safe diagnostics for stale/unreconciled state.
- [ ] Add rendered-site scheduled-recovery tests and real runtime scheduling verification, then run applicable checks.

## Blocked by

- #44: Honor withdrawals without resurrecting content
- #45: Refresh shared settings across affected pages
- #46: Retry failed delivery and report publishing delays
