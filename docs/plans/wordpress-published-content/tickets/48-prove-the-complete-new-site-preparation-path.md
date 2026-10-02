## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

A Site creator follows the Blueprint's explicit new content Site preparation/provisioning flow and obtains a production-ready published website with durable delivery, authenticated events, retries, reconciliation and independent media. Prove the complete editor-to-visitor path on a disposable real-CMS/Worker Site without turning generation into a networked or secret-bearing operation.

Earlier slices already include their own rendered-site tests; this final slice integrates provisioning/readiness and real-runtime acceptance rather than deferring all verification until the end. Its two blockers cover the complete transitive feature path plus the independently delivered media prerequisite.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] Generate a new content Site offline with public configuration/placeholders only, then explicitly provision required content storage/runtime permissions, event credentials, background execution and independent media through the established authority model.
- [ ] Distinguish runtime startup from CMS readiness: verify WordPress installation, required plugin/theme activation, actual WPGraphQL fields, runtime bindings/secrets, retry/reconciliation execution and independent uploads before declaring the resilience guarantee ready.
- [ ] Populate initial supported published routes and shared data through an explicit repeatable preparation path; an unseeded cache, HTTP 200 or matching CMS title alone is not a production-ready result.
- [ ] On a compatible real WordPress stack and the actual pinned Astro/Alchemy/Cloudflare build/serve path, demonstrate publication, shared-setting refresh, lost-event reconciliation, CMS outage, prolonged stale serving, immediate received withdrawal and restart/redeploy preservation.
- [ ] Verify uncached/unavailable versus confirmed-missing 503/404 behaviour, invalid event rejection, Site isolation, failed refresh preservation, editor-visible delivery delays and retry recovery in the integrated flow.
- [ ] Upload media and verify independent public assets remain accessible during CMS outage; do not substitute URL inspection for upload/read evidence.
- [ ] Make the integrated acceptance gate repeatable, retain portable execution/evidence instructions and clean up disposable resources. Wire appropriate deterministic generated-site tests into recurring checks; retain the separate real-runtime compatibility gate.
- [ ] Preserve existing site-owned applications, create-once skeleton rules and deploy extensions; do not run production migration extensions locally or silently reset an existing CMS. Validate these ownership guarantees through existing and new tests.
- [ ] Document the supported new-content-Site flow and observable not-ready/failure outcomes; coordinate shared runtime and health ownership with existing efforts without deciding the renderer package home or migrating existing Sites.
- [ ] Run repository, generated Frontend and applicable CMS/infrastructure format/lint/check/test commands, and record the actual runtime proof rather than treating type checks as an artifact build.

## Blocked by

- #40: Keep uploaded media available during CMS outages
- #47: Reconcile missed changes within five minutes
