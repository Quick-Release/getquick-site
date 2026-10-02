# WordPress published-content delivery: resume here

## State at handoff

Architecture review and specification are complete; implementation has not started.
The user approved the ten-ticket breakdown and its blocking edges. GitHub Issues
are authoritative for current scope, comments and execution state. The documents
in this directory are portable snapshots from 2026-10-02, not another tracker.

- [Spec #38](https://github.com/Quick-Release/gq-site/issues/38) · [local snapshot](spec.md)
- [Architecture report](../../research/wordpress-frontend-architecture.html)
- All ten execution tickets were published with `ready-for-agent`; their eleven
  native blocking links were verified. The parent issue was left unchanged.
- The initial execution frontier was **#39 and #40**. Recheck GitHub before starting.

## Continue on another machine

1. Check out the Git branch containing this handoff and read the
   [spec snapshot](spec.md), [Glossary](../../../GLOSSARY.md), and relevant
   [Blueprint ADRs](../../adr/).
2. Fetch the current parent and chosen ticket, including comments, through `gh`.
   Recheck its native blocking links and existing work; the snapshot table below
   records the graph at handoff, not live completion state.
3. Implement one ready ticket in a fresh context, test through the generated
   Site's rendered Frontend, and follow the repo's checks. The spec distinguishes
   fast deterministic scenarios from the real CMS/Cloudflare compatibility gate.
4. Preserve the agreed ownership model: new content Sites first, offline and
   secret-free generation, create-once App skeletons, and explicit provisioning.
   Coordinate shared packaging with existing issues #8/#32 rather than creating
   a competing package decision.

Use the [issue-tracker instructions](../../agents/issue-tracker.md) for GitHub
operations. Access to the private Composer registry and disposable infrastructure
may require configuring this machine's credentials; obtain them through the
existing secret authority model, not these documents.

## Ticket graph snapshot

| Ticket                                                    | Deliverable and local snapshot                                                                                | Blocked by    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------- |
| [#39](https://github.com/Quick-Release/gq-site/issues/39) | [Missing content versus CMS failures](tickets/39-distinguish-missing-content-from-cms-failures.md)            | None          |
| [#40](https://github.com/Quick-Release/gq-site/issues/40) | [Independent media](tickets/40-keep-uploaded-media-available-during-cms-outages.md)                           | None          |
| [#41](https://github.com/Quick-Release/gq-site/issues/41) | [Durable homepage](tickets/41-serve-a-durable-last-known-good-homepage.md)                                    | #39           |
| [#42](https://github.com/Quick-Release/gq-site/issues/42) | [Published pages and posts](tickets/42-extend-cached-delivery-to-published-pages-and-posts.md)                | #41           |
| [#43](https://github.com/Quick-Release/gq-site/issues/43) | [Authenticated publication events](tickets/43-refresh-publications-through-authenticated-wordpress-events.md) | #42           |
| [#44](https://github.com/Quick-Release/gq-site/issues/44) | [Withdrawal and ordering safety](tickets/44-honor-withdrawals-without-resurrecting-content.md)                | #43           |
| [#45](https://github.com/Quick-Release/gq-site/issues/45) | [Shared-setting events](tickets/45-refresh-shared-settings-across-affected-pages.md)                          | #43           |
| [#46](https://github.com/Quick-Release/gq-site/issues/46) | [Retries and delay reporting](tickets/46-retry-failed-delivery-and-report-publishing-delays.md)               | #43           |
| [#47](https://github.com/Quick-Release/gq-site/issues/47) | [Five-minute reconciliation](tickets/47-reconcile-missed-changes-within-five-minutes.md)                      | #44, #45, #46 |
| [#48](https://github.com/Quick-Release/gq-site/issues/48) | [Integrated new-Site preparation](tickets/48-prove-the-complete-new-site-preparation-path.md)                 | #40, #47      |

## Technical discovery still required

The approved behaviour is specified; storage and execution mechanisms are not yet
chosen. Before implementing the relevant slice:

- Inspect private GETQUICK CMS modules for existing schema/event capabilities.
- Verify bindings, runtime secrets and scheduling against the pinned
  Alchemy/Astro/Cloudflare integration, not just deploy-time environment values.
- Select durability and consistency that enforce accepted withdrawals and
  event ordering; best-effort edge invalidation is not proof of that guarantee.
- Production disables traffic-driven WordPress cron; verify or establish actual
  background execution for retries and reconciliation.

These prerequisites are assigned to the execution tickets. The report's findings
about unavailable private-package internals are limits of the review, not proof
those packages are missing functionality.

## Evidence preserved

The report contains the architecture findings, verification limits and selected
product policies. The spec and ticket snapshots preserve the published issue
bodies; their historical reference to a session-local report predates this
committed archive.

Review baseline: 355 repository tests and 22 separately run Frontend library
tests passed. Three temporary probes reproduced dynamic HTML being discarded,
CMS failure equalling a missing entry, and absent design tokens discarding valid
homepage data. These were current-behaviour observations, not implemented fixes
or a real generated Astro/CMS compatibility proof.

The copied libraries, temporary test harness, background logs and one-off GitHub
publishing script are disposable execution material, not prerequisites for
continuing. No credentials are included in this archive. The report's text and
custom diagrams are local; enhanced Tailwind styling and Mermaid diagrams load
from CDNs and need network access.

## Suggested skills

- `/implement` to work one ready execution ticket; start fresh from its issue.
- `/tdd` to drive observable behaviour one red-green slice at a time.
- `/codebase-design` when choosing delivery, storage and refresh seams.
- `/code-review` to review the implementation against standards and the ticket.
- `/wizard` only when infrastructure or credential setup genuinely needs a human.

Ticket decomposition is already approved and published; the next session should
implement the live frontier rather than repeat the architecture interview.
