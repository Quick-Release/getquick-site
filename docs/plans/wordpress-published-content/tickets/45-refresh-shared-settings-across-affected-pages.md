## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

An editor can change menus, logo, site identity or design presets and see those changes across the affected cached website without republishing every page. Failed or stale settings refreshes preserve the previous coherent public representation.

This slice can run independently of withdrawal and retry implementation once authenticated publication delivery exists. New shared-setting event kinds must obey the common event/recovery contract so the retry slice does not need setting-specific duplication.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] Determine supported change sources in the actual GETQUICK CMS modules/theme and deliver authenticated refresh events for menus, logo, site identity and design presets, not just post modification timestamps.
- [ ] For each supported setting, change it in a compatible CMS and verify the updated setting through the rendered homepage and affected entry pages without a Frontend deploy or manual republishing of each entry.
- [ ] Refresh all affected public representations while preserving valid published entry content. A shared-data failure does not erase branding, navigation or design data.
- [ ] Duplicate and out-of-order shared-setting events cannot replace newer accepted settings; define a change identity/order usable by later retries and reconciliation.
- [ ] During a CMS outage, visitors retain the previously successful shared settings with their cached pages; settings refresh failure records safe pending/failed diagnostics.
- [ ] Use the same authenticated, Site-isolated event authority and recovery semantics as publication delivery; do not introduce a second competing public-mutation mechanism.
- [ ] Add rendered-site tests for each supported setting, multiple affected pages, partial failure and delayed events, with real CMS verification of the relevant hooks/data.
- [ ] Do not expand support to arbitrary plugins, multilingual behaviour, renderer reconstruction or a nested-navigation presentation redesign; cache and refresh the supported existing representation.

## Blocked by

- #43: Refresh publications through authenticated WordPress events
