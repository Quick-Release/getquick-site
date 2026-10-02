## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

An editor's publication of a supported WordPress page or post refreshes that Site's public Frontend without a deployment. The event path is authenticated and Site-scoped, and failed processing preserves the old publication instead of blocking the editor or exposing a public cache-mutation mechanism.

Durable automated retry execution and the finished editor-facing delay report belong to their own slice. This ticket must leave recoverable delivery state, not pretend that one best-effort webhook is reliable. Do not create a competing shared-renderer package or settle its existing package-home decision.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] Inspect the supported owned CMS packages for suitable existing publication hooks/delivery behaviour, then implement or extend the appropriate owned module rather than assuming those private packages lack the capability.
- [ ] Through a disposable compatible WordPress CMS and Frontend, publishing or updating a public page/post emits an authenticated event and successful processing changes the rendered public content without deployment.
- [ ] Establish event identity, publication ordering and a recoverable delivery/processing record sufficient for subsequent withdrawals and durable retries. Duplicate or delayed publications cannot overwrite a newer accepted publication.
- [ ] Invalid authentication, unsupported/malformed actions and wrong-Site requests are rejected without modifying public state. Browser CORS and deployment tokens are not used as refresh authentication.
- [ ] Wire the Site's CMS and Frontend runtime credentials through explicit secret provisioning/deployment paths, verifying runtime availability and Site isolation without exposing values in generated files, diagnostics or request responses.
- [ ] Publishing still succeeds when event dispatch or refresh fails; preserve the previous good publication, bound synchronous work and retain actionable pending/failed state for the retry/reporting slice.
- [ ] An accepted publication event does not import draft/private responses into the public cache; only successfully validated public CMS state is promoted.
- [ ] Add rendered-site event acceptance tests plus real CMS hook/runtime-secret verification; retain offline generation and existing site-owned app/extension preservation.

## Blocked by

- #42: Extend cached delivery to published pages and posts
