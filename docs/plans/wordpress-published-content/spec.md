## Problem Statement

New GETQUICK content sites currently render their public Frontend by reading the CMS during visitor requests. A CMS outage can replace the homepage with an empty state, remove navigation and branding, or turn a real published page into a misleading 404. An editor can therefore lose the public website's availability even though its last published content remains valid.

The Blueprint supplies an App skeleton rather than a published-content delivery guarantee. It does not currently establish a durable last-known-good store, publication-driven refresh, missed-event recovery, or independent media hosting as a prerequisite for that guarantee. Successful generation, type checks and title-only smoke checks do not prove the editor-to-visitor behaviour.

## Solution

Make the Frontend of a newly created content Site serve a durable last-known-good representation of published content and shared site settings. WordPress events refresh that representation; periodic reconciliation catches missed events within a five-minute target window while the CMS is healthy.

During a CMS outage, visitors continue receiving the last successful content without an age limit. A received unpublish/delete event immediately withdraws the affected cached content. Editors can finish publishing even when refresh is delayed: failures preserve the previous good content, retry, and report the delay.

Require WordPress uploads to be hosted independently through the existing R2 media path so a CMS outage does not also remove those assets. Prove the behaviour through a disposable generated Site's public Frontend, supplemented by real-CMS and Cloudflare runtime compatibility checks.

## User Stories

1. As a visitor, I want a published page to remain available when the CMS is unreachable, so that an editorial-backend outage does not take down the public website.
2. As a visitor, I want the homepage to retain its published content during an outage, so that I do not see a development placeholder on a production Site.
3. As a visitor, I want navigation, branding and design presets to remain available with cached content, so that the website remains usable rather than showing only an isolated article body.
4. As a visitor, I want independently hosted WordPress uploads to remain available during a CMS outage, so that cached pages retain their images and other uploaded assets.
5. As a visitor, I want the Frontend to keep its last-known-good content throughout a prolonged outage, so that availability does not end at an arbitrary cache-age limit.
6. As a visitor, I want a genuine missing page to return 404, so that the website accurately distinguishes absent content from an infrastructure failure.
7. As a visitor, I want unavailable content with no successful cached copy to return 503, so that a temporary CMS failure is not misrepresented as permanent absence.
8. As a visitor, I want published changes to appear after successful event-driven refresh, so that the website follows the editor's publications without reading the CMS on every normal cached request.
9. As a visitor, I want a failed refresh to leave the last successful content intact, so that partial failures do not replace usable content with empty or broken output.
10. As a visitor, I want the website to recover after the CMS becomes reachable again, so that an outage does not require manual rebuilding of every cached page.
11. As an editor, I want publishing a page or post to trigger public-content refresh, so that I do not have to redeploy the Frontend to update editorial content.
12. As an editor, I want changes to menus, logo, site identity and design presets to trigger refresh, so that shared editorial settings reach the public website too.
13. As an editor, I want to finish publishing when the Frontend refresh path is unavailable, so that Frontend failures do not block editorial work.
14. As an editor, I want unsuccessful refreshes to retry, so that a temporary delivery or CMS-read failure can recover without republishing.
15. As an editor, I want delayed or failed refreshes to be reported, so that I can distinguish successful WordPress publication from successful public delivery.
16. As an editor, I want a received unpublish/delete event to stop serving the affected cached content immediately, so that the outage fallback does not resurrect content I explicitly withdrew.
17. As an editor, I want a renamed or moved published URI to stop presenting a superseded cached publication as current, so that refresh reconciles the public representation with the CMS.
18. As an editor, I want reconciliation to catch a missed event within a five-minute target window while the CMS is healthy, so that lost notifications do not leave the website stale indefinitely.
19. As an editor, I want reconciliation failures during an outage to preserve good content, so that background maintenance cannot accidentally blank the website.
20. As an editor, I want drafts, revisions and private editorial content to remain outside the public cache, so that reliability does not expose unpublished information.
21. As an operator, I want publication-event delivery to be authenticated, so that anonymous callers cannot refresh, remove or inject public content.
22. As an operator, I want duplicate and out-of-order events to be safe, so that retries or delayed messages cannot overwrite a newer publication or undo a withdrawal.
23. As an operator, I want cached content and withdrawal state to survive Worker restarts and routine deployment, so that the reliability guarantee is not limited to process memory.
24. As an operator, I want refresh and reconciliation to work without visitor traffic, so that unpopular pages and Sites still recover from missed events.
25. As an operator, I want independent Sites to keep separate content, credentials and refresh state, so that one Site's event or failure cannot affect another.
26. As an operator, I want useful refresh diagnostics without secret values or private content, so that I can investigate failures safely.
27. As an operator, I want local runtime startup to be distinguished from CMS readiness for the Frontend, so that a running DDEV process is not mistaken for a compatible, installed and activated CMS.
28. As a Site creator, I want the new content Site's normal preparation and provisioning path to establish the reliability prerequisites, so that outage support does not depend on rediscovering undocumented steps.
29. As a Site creator, I want generation to remain offline and secret-free, so that creating a Site does not silently provision infrastructure or acquire deployment authority.
30. As a Site maintainer, I want existing site-owned applications and deploy extensions to remain untouched, so that adding the feature does not overwrite client customizations.
31. As a Blueprint maintainer, I want automated tests to generate and render a disposable Site, so that changes are checked through observable website behaviour rather than emitted file strings alone.
32. As a Blueprint maintainer, I want a real CMS and deployed-runtime compatibility gate, so that mock responses cannot hide an unsupported WordPress schema or Cloudflare binding.
33. As a Blueprint maintainer, I want common delivery policy to have a coherent shared ownership path, so that fixes can eventually reach the Fleet without copying runtime code into every Site.

## Implementation Decisions

### Agreed serving and freshness policy

- Scope the first delivery guarantee to newly created **content** Sites using the supported GETQUICK WordPress stack and Astro Frontend. Do not infer arbitrary WordPress-plugin compatibility.
- Cached published content is the normal serving source. Successful WordPress publication events refresh it; this is not merely a cache used after live visitor requests fail.
- Last-known-good content has **no outage-age limit**. Preserve it until a successful refresh replaces it or an explicit withdrawal is accepted.
- A received unpublish/delete event withdraws the affected public content immediately, even if the CMS cannot subsequently be read. An explicitly withdrawn URI must not regain old content through fallback, delayed events or reconciliation.
- Reconciliation targets missed-event recovery within **five minutes while the CMS and refresh dependencies are healthy**. Treat that as a feature acceptance target under controlled conditions, not a guarantee through outages, scheduler delays or arbitrary overload.
- Refresh coverage includes published pages/posts and shared menus, logo, site identity and design presets. Changes in shared data must refresh all affected public representations rather than only the last edited entry.
- Publishing remains available when refresh fails. Retry and report the delay; do not make a successful Frontend refresh a prerequisite for the editor finishing publication.
- Require independent WordPress upload hosting through the existing R2 media path for the production guarantee.
- Preserve friendly local development without a CMS. Production failures must not silently become development placeholders.

### Module shape and state integrity

- Deepen CMS delivery into a module that owns publication state, refresh outcome interpretation, withdrawal precedence and reconciliation. Keep storage, HTTP transport and scheduling choices behind internal seams rather than making routes coordinate them.
- Prefer the existing public Frontend and owned CMS/deploy seams. A separate helper around `fetch` is insufficient: the module must concentrate the policy currently spread across content loading, site chrome and failure handling.
- Distinguish confirmed missing/withdrawn content from unavailable CMS content and invalid required schema. The current missing/empty fallback results are not safe refresh inputs.
- Promote a replacement only after the required content and shared data have been successfully read and validated. Partial GraphQL failures, missing required fields and transport errors must not overwrite a good representation or be interpreted as content deletion.
- Preserve a publication's necessary shared data across refresh failure; a separately failed chrome read must not erase navigation or branding while the page remains cached.
- Persist last-known-good content and accepted withdrawal state independently of the CMS and Worker process lifetime. Prevent destructive rebuilds on deployment and prevent incompatible cached state from being silently misinterpreted after an upgrade.
- Make processing idempotent and enforce publication ordering. A delayed publish, retry or in-flight refresh must not resurrect content after a newer withdrawal or overwrite a newer accepted publication.
- Do not mix public cached data with drafts, private/authenticated responses or visitor-specific content. Use Site isolation for content state and refresh authority.
- Preserve honest public status semantics: confirmed missing/withdrawn content returns 404; a CMS/storage failure without a usable representation returns 503. Lack of a cache entry alone does not establish that a URI is missing.
- Initial preparation, cold-cache handling and new-publication refresh must be explicit, observable paths. An unseeded Site must not be declared production-ready solely because the Worker responds or the CMS title can be queried.

### Delivery, scheduling and operations

- Authenticate CMS-originated refresh/withdrawal events and validate their Site and supported action. Browser CORS is not authentication.
- Establish retry execution and periodic reconciliation independently of visitor traffic. Production currently disables WordPress's traffic-driven cron, so a retry design must verify or add a real scheduler rather than assume one exists.
- Keep event reception, delivery bookkeeping and refresh execution recoverable across transient failures. Diagnostics must make publication-to-public-delivery delay visible without exposing credentials or private editorial data.
- Use the existing Sigillo authority model for provisioning/deployment secrets. Do not persist injected secret environments in generated files or reuse deployment tokens as public refresh credentials.
- Check that WordPress, the required theme/plugins, the required WPGraphQL fields and independent media configuration are actually ready. Runtime startup and CMS readiness are distinct outcomes.
- Do not run production migration extensions locally or silently reset an existing CMS as part of preparation.

### Blueprint ownership and related work

- Keep generation deterministic, offline and secret-free; provision and prepare through explicit post-generation steps.
- Preserve the accepted create-once/site-owned App skeleton policy. Existing Site adoption is not automatic and must not be achieved by reclassifying entire applications as fully generated.
- Keep common runtime policy eligible for versioned shared modules in line with the Blueprint ADRs. Coordinate WordPress client/runtime packaging with the existing shared-renderer effort rather than creating a competing package/interface decision.
- This spec does not settle the shared package's home, the commerce framework seam or the broader renderer exports. Those remain the existing decision work.

### Technical verification required before implementation choices are fixed

These are discovery/implementation prerequisites, not open product-policy questions:

- Inspect the owned private GETQUICK Composer modules for existing publication hooks, event delivery, schema support and appropriate ownership of shared CMS behaviour. Their implementations were not available in the reviewed checkout.
- Verify runtime storage bindings, runtime secrets and scheduled execution against the **pinned** Alchemy/Astro/Cloudflare integration. A deploy-time environment variable is not proof of a runtime secret binding.
- Select durable storage and consistency semantics that satisfy the agreed withdrawal, ordering, outage and deployment guarantees. Do not assume a best-effort edge cache or eventually propagated invalidation automatically provides immediate withdrawal.
- Determine the event/reconciliation change-detection mechanism for all supported shared settings, not only post modification timestamps.
- Verify provisioning permissions and credential propagation for any new runtime resources.
- Define compatible persisted-state evolution and the concrete bootstrap/diagnostic path within the existing ownership model.
- Keep these facts and chosen mechanisms with the implementation decisions/tickets; do not mark a mock-only result as real runtime compatibility.

## Testing Decisions

### Primary seam — agreed with the user

Test the highest meaningful seam: **a disposable generated Site's public Frontend**. Drive CMS publications, shared-setting changes, withdrawals, delivery failures and outages, then assert rendered content, navigation, media references and HTTP status. Tests should describe editor-to-visitor behaviour, not private cache functions or a particular database layout.

Use deterministic owned-CMS responses and controllable delivery/scheduling adapters for fast scenarios. Supplement them with a real WordPress/GETQUICK stack and actual Cloudflare runtime build/serve compatibility gate. The latter must exercise the same adapter path used in deployment, not a type-check-only command.

### Required acceptance scenarios

1. Generate and prepare a new content Site, establish a compatible CMS and independent media hosting, populate its public representation, and verify the expected published homepage, entry and site chrome through the Frontend.
2. After successful publication, make the CMS unreachable. The same cached public pages, navigation, logo and design-dependent content remain available; uploaded-media references target independent hosting.
3. Advance beyond ordinary cache-age limits during the outage. Last-known-good content continues to be served; no fixed-age expiry is introduced.
4. Fail a refresh through timeout, HTTP error, GraphQL error, missing required schema and incomplete shared data. The last successful representation remains intact and the failure is diagnosed.
5. Publish a content change, deliver its event and complete refresh. Visitors observe the new publication without a Frontend deploy.
6. Change each supported shared setting and verify affected cached pages observe the refreshed setting.
7. Lose a publication event while dependencies remain healthy. Controlled reconciliation makes the change visible within the five-minute target window without requiring visitor traffic.
8. Fail reconciliation during an outage. Existing content is retained; subsequent recovery reconciles the missed changes.
9. Deliver a withdrawal, then make the CMS unavailable. The affected route returns 404 and never serves its former cached publication.
10. Deliver duplicate and out-of-order events and race an in-flight refresh with a withdrawal. The newest accepted state wins and old content is not resurrected.
11. Exercise a URI change, a new publication, a confirmed missing URI and an uncached request while the CMS is unavailable. Verify correct published-content and 404/503 distinctions without treating a cache miss as proof of absence.
12. Restart/redeploy the Frontend and resume interrupted work. Published content and withdrawal state persist; retries remain safe.
13. Fail event delivery or refresh while publishing. WordPress publication succeeds, the delay is reported, and retries recover without the editor republishing.
14. Reject unauthenticated, malformed, wrong-Site and otherwise invalid refresh/withdrawal requests without changing public state or disclosing credentials.
15. Confirm drafts/private content and visitor-specific responses never enter the public cache.
16. Verify Site isolation: one Site's publication, withdrawal or refresh credential cannot modify another Site's content.
17. Verify independent-media readiness and exercise the upload path against the intended runtime; do not equate cached HTML with copying CMS-hosted assets.
18. Preserve no-CMS local development, offline/secret-free generation, and existing site-owned files and deploy extensions.

### Prior art and coverage limits

- Existing generation/ownership tests already prove deterministic generation, preservation of site-owned files and secret-free operation; retain those guarantees.
- Existing Frontend tests cover mocked WordPress reads, narrow retry behaviour, menu normalization and selected block rendering. Move coverage to observable delivery outcomes where the policy changes, replacing obsolete expectations only after equivalent higher-seam coverage exists.
- Existing CI webhook handling provides signing, duplicate-delivery and retry precedent, but is not an implemented CMS publication path.
- The existing hosted generation smoke proved deployment and title propagation. Extend the acceptance evidence to published content, shared settings and outage behaviour rather than claiming that prior deployment was broken.
- The review baseline passed 355 repository tests and 22 separately executed Frontend library tests. Three temporary probes confirmed content-loss/failure-semantics shortcomings. These results do not constitute a generated Astro artifact build, browser-rendering check or live private-package compatibility test.

## Out of Scope

- Automatic migration or overwrite of existing Sites' site-owned applications.
- Commerce, cart, checkout, account or visitor-personalized caching.
- Draft preview, authenticated editorial rendering, password-protected-content delivery or exposing private CMS data through the public cache.
- Adding archives, search, custom-post-type support, multilingual support or SEO-plugin integration beyond the current supported published routes.
- Fixing unrelated renderer reconstruction, nested-menu presentation or saved-body-link shortcomings identified by the architecture review; coordinate those as separate work.
- A universal Gutenberg renderer, automatic arbitrary plugin-script execution or a general WordPress-theme translator.
- Resolving the shared renderer's package home, exports or commerce integration decision.
- Fleet-wide automatic promotion, CMS code rollback, database recovery or a new management dashboard.
- Availability guarantees for third-party embeds or independently hosted media whose own provider is unavailable.
- Instant detection of a withdrawal when both the CMS is unreachable and its withdrawal event never reaches the Frontend. This is unknowable from previously published cached content; the agreed unlimited outage fallback accepts that limitation.

## Further Notes

- This is a multi-session build specification synthesized from the architecture review and the user's chosen policies. No runtime implementation was performed during the review.
- Follow the Blueprint's accepted architecture: independent Sites, Bedrock CMS with WPGraphQL, Astro Frontend on Cloudflare Workers, one validated Site manifest, explicit provisioning authority and site-owned App skeletons.
- Related work: [shared block renderer #8](https://github.com/Quick-Release/gq-site/issues/8), [shared renderer package/interface decision #32](https://github.com/Quick-Release/gq-site/issues/32), and [deployed-site health decision #26](https://github.com/Quick-Release/gq-site/issues/26). Coordinate overlapping runtime/client and health work rather than duplicating it. No new blocking edge is asserted merely because those efforts are related.
- Split implementation into self-contained tracer-bullet tickets with explicit blocking edges after the technical prerequisites are understood. A ticket choosing or modifying shared packaging must respect the existing package-design decision's dependency.
- The architecture report is a session-local artifact, not a portable dependency of this spec. This issue contains the decisions and acceptance requirements needed by a fresh implementation session.
