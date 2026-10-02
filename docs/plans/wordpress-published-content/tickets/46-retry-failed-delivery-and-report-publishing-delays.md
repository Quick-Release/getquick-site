## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

An editor can finish publishing during a transient delivery/refresh failure, see that public delivery is delayed, and have the website recover automatically without republishing or waiting for visitors. Operators receive safe, actionable diagnostics rather than an invisible permanently stale cache.

Only authenticated publication delivery genuinely gates this generic recovery slice. It may run alongside withdrawal and shared-setting slices; final reconciliation and integration verify their interaction. Define extension-friendly common event semantics rather than adding artificial blockers on each event kind.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] Persist pending/failed event delivery and refresh work, execute retries independently of visitor traffic and recover after transient sender, receiver or CMS-read failures.
- [ ] Verify or establish an actual retry scheduler/executor; production's disabled traffic-driven WordPress cron must not be mistaken for an active background scheduler.
- [ ] Exercise publishing with dispatch failure and with receiver-side refresh failure. WordPress publication succeeds, the last good public copy remains, and restored dependencies allow retry to deliver the new publication without another publish action.
- [ ] Expose publication-to-public-delivery pending/failed/recovered status to the editor and safe operator diagnostics, distinguishing CMS publication success from public delivery success without adding a new management dashboard.
- [ ] Use the common event contract so retry execution supports publication, withdrawal and shared-setting events as those slices add them; avoid a publication-only retry implementation requiring separate mechanisms later.
- [ ] Duplicate/replayed work respects accepted publication ordering, can resume after interruption/restart, and cannot overwrite newer state. Handle bounded attempts/backoff and persistent failures observably without dropping the last good publication.
- [ ] Never expose refresh credentials, injected secret environments or private CMS payloads in logs, status reporting or public responses; preserve Site isolation.
- [ ] Add rendered-site recovery tests with controllable time/delivery, restart/interruption tests and real scheduler evidence; run applicable checks.

## Blocked by

- #43: Refresh publications through authenticated WordPress events
