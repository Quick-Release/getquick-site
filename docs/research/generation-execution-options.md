# Where `gq sync` can run: Renovate hosting and CI write-back

Research for [#23](https://github.com/Quick-Release/getquick-site/issues/23) on
the [phase 4 map (#18)](https://github.com/Quick-Release/getquick-site/issues/18).
It compares the places generation can run when a dependency update changes
managed files. It measures each one against the rollout plan's
[Where generation runs](../plans/getquick-blueprint-rollout.md#where-generation-runs)
requirements. It compares the options and does not pick one: that choice is
[#34](https://github.com/Quick-Release/getquick-site/issues/34).

Researched on 2026-10-02. Earlier findings are in
[update mechanics, section 4](getquick-blueprint-update-mechanics.md#4-renovate-cannot-universally-run-gq-sync-out-of-the-box);
this note goes further on verification, write-back, reruns and cost.

## Sources and versions

| Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Version / date                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Renovate docs: [`postUpgradeTasks`](https://docs.renovatebot.com/configuration-options/#postupgradetasks), [`gitIgnoredAuthors`](https://docs.renovatebot.com/configuration-options/#gitignoredauthors), [`platformCommit`](https://docs.renovatebot.com/configuration-options/#platformcommit), [`allowedCommands`](https://docs.renovatebot.com/self-hosted-configuration/#allowedcommands), [`allowedEnv`](https://docs.renovatebot.com/self-hosted-configuration/#allowedenv), [`exposeAllEnv`](https://docs.renovatebot.com/self-hosted-configuration/#exposeallenv), [security and permissions](https://docs.renovatebot.com/security-and-permissions/), [running Renovate](https://docs.renovatebot.com/getting-started/running/), [GitHub platform](https://docs.renovatebot.com/modules/platform/github/) | Renovate 44.132.2 (released 2026-10-02); markdown read from `renovatebot/renovate@ae4be1695` |
| Renovate source: [`lib/config/options/index.ts`](https://github.com/renovatebot/renovate/blob/ae4be1695/lib/config/options/index.ts), [`lib/modules/platform/github/scm.ts`](https://github.com/renovatebot/renovate/blob/ae4be1695/lib/modules/platform/github/scm.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `ae4be1695`                                                                                  |
| Mend-hosted: [FAQ](https://docs.renovatebot.com/mend-hosted/faq/), [overview and plans](https://docs.renovatebot.com/mend-hosted/overview/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Renovate docs 44.132.2                                                                       |
| Mend Renovate CE/EE: [`mend/renovate-ce-ee`](https://github.com/mend/renovate-ce-ee)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `62db6bf8e` (2026-09-25)                                                                     |
| `@cloudflare/ci` source (in Ekis's `node_modules`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 0.2.0 (2026-09-14)                                                                           |
| Cloudflare docs: [Containers pricing](https://developers.cloudflare.com/containers/pricing/), [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/), [Artifacts pricing](https://developers.cloudflare.com/artifacts/platform/pricing/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | last updated 2026-08-28, 2026-09-21 and 2026-10-01                                           |
| GitHub docs: [commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification), [installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), [ruleset rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [webhook payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads); GraphQL `createCommitOnBranch` (live schema introspection)                                                                                                                                                      | retrieved 2026-10-02 (the pages show no dates)                                               |
| This repo: [`src/sync/commands.mjs`](../../src/sync/commands.mjs), [`src/sync/managed-files.mjs`](../../src/sync/managed-files.mjs), [`blueprint/templates/infra/ci/`](../../blueprint/templates/infra/ci/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `45d372d`                                                                                    |
| Ekis: [`apps/cloudflare-ci`](https://github.com/Quick-Release/ekis/tree/ce258d8/apps/cloudflare-ci), [`docs/runbooks/revision-verification.md`](https://github.com/Quick-Release/ekis/blob/ce258d8/docs/runbooks/revision-verification.md), [ADR 0008](https://github.com/Quick-Release/ekis/blob/ce258d8/docs/adr/0008-getquick-site-blueprint.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `main` at `ce258d8`                                                                          |

## The requirements

From the plan's [Where generation runs](../plans/getquick-blueprint-rollout.md#where-generation-runs):

- **R1. Verify the bot, repository, dependency change and exact revision.**
  A branch name doesn't count as authorization.
- **R2. No production credentials** reach generation.
- **R3. Write-back paths are restricted.**
- **R4. Checks rerun** after generation changes a PR.
- **R5. Reuse Cloudflare CI where appropriate.** GitHub Actions isn't a
  prerequisite.

Each option is also costed and placed (where it runs).

## What `gq sync` needs

Generation is light, which shapes every option.

- **No network or secrets.** `gq sync` says so itself
  ([`src/sync/commands.mjs`](../../src/sync/commands.mjs) header). It needs an
  installed `@getquick/site`, so the job first runs `pnpm install`. That step
  needs registry access, and a registry token if the package stays private
  (still open: Ekis [ADR 0008](https://github.com/Quick-Release/ekis/blob/ce258d8/docs/adr/0008-getquick-site-blueprint.md)).
  It doesn't need Composer: the `COMPOSER_AUTH` secret in the template's install
  step serves `composer install`, which generation doesn't need.
- **Known write set.** It writes the managed files, sections and keys listed in
  the installed package's `blueprint/ownership.json`. It also writes
  `gq.ops.json` and `gq.lock.json`, and creates missing create-once files. It
  may delete a leftover `shop-devtools.config.mjs`
  ([`managed-files.mjs`](../../src/sync/managed-files.mjs)). That gives a
  computable allowlist of paths: the ownership list from the _new_ package,
  plus those three fixed paths.
- **Stops on local edits.** If a managed file was edited by hand, sync stops
  with a diff and writes nothing. `--check` reports pending changes and exits 1.
  So a generation job has to handle "sync refused" as a normal outcome and
  report it to the PR. It shouldn't treat it as an infrastructure failure.
- **Runs the code being upgraded.** The `gq` that runs is the _new_
  `@getquick/site` from the update. This is Renovate's
  "[outsider attack](https://docs.renovatebot.com/security-and-permissions/#execution-of-code-outsider-attack)":
  a postUpgradeTask "that may use an updated dependency". Every option executes
  the upgraded package, so none of them removes this risk. They differ in what
  that code can reach while it runs.

## The options

### A. Self-hosted Renovate with allowlisted `postUpgradeTasks`

**How it works.** Renovate runs `postUpgradeTasks.commands` "after a dependency
has been updated but before the commit is created". Its commit then includes
any changed file that matches `fileFilters`. The default is `**/*`, any
non-ignored file. Commands are "blocked by default"; each one must match a
pattern in the global-only `allowedCommands` (default `[]`). Templated commands
are compiled _before_ that match, so the pattern has to be anchored
(`^pnpm exec gq sync$`). `executionMode: "branch"` runs the task once per
branch rather than once per dependency.

**Hosting choices** ([running Renovate](https://docs.renovatebot.com/getting-started/running/)):

- **Renovate OSS.** An npm package or Docker image (AGPL-3.0). It needs "some
  form of cron-like capability" plus VM or container infrastructure. The GitHub
  Action form is ruled out by R5.
- **Mend Renovate CE (Community Edition).** Closed-source and self-hosted,
  licensed under a EULA. You request a license key through Mend's form. It is
  stateful and long-lived, gets webhooks as a GitHub App, and has a priority
  queue. It ships every 2 weeks. EE adds horizontal scaling, support and Smart
  Merge Control.

**Against the requirements**

- **R1, partly met by design.** Renovate only runs the task on branches it made
  itself, as part of the update. Bot, repository, dependency change and revision
  are inherent: there is no outside trigger to verify. It is still worth having
  CI confirm the PR came from the expected App (see C's checks). Renovate signs
  its own commits when it runs as a GitHub App: `platformCommit` defaults to
  `auto`, which becomes `enabled` for an App
  ([`scm.ts`](https://github.com/renovatebot/renovate/blob/ae4be1695/lib/modules/platform/github/scm.ts)).
  Those commits are created through GitHub's API and show as verified.
- **R2, weak.** The task runs inside the Renovate worker. That worker holds an
  installation token with Contents write. Renovate runs "on multiple
  organizations" by separate invocations, so one installation can cover every
  site repo in an org. Renovate passes only a limited set of environment
  variables to child processes (`exposeAllEnv` is off by default).
  - What follows is my inference, not a documented claim. Upgraded code runs
    in the same container and the same Git checkout as a process holding a
    multi-repo write credential. Mend warns that "by calling a `make` task,
    other arbitrary command execution can occur". Production credentials stay
    out (none are configured), but credentials for writing to _other_ sites'
    repos aren't isolated.
- **R3, configured by the repository, not enforced by the admin.**
  `fileFilters` limits what gets committed. But it is repository config, and
  it filters the commit; it doesn't sandbox the files the task can write. The
  admin controls only `allowedCommands` (and `allowedEnv`). The generated
  `renovate.json` could pin `fileFilters` to the ownership list. A site edit to
  that file would still widen it.
- **R4, met.** The generated files go in the same commit Renovate pushes. CI
  checks run once, on the final commit. No second push is needed.
- **R5, neutral.** Cloudflare CI only checks the result. The Renovate runtime
  is a separate service to operate.

**Cost and hosting.** Renovate OSS costs nothing to license; you pay for
compute and operations. CE is free to license with a key, but needs an
always-on service.

The following figures are my illustration, from
[Containers pricing](https://developers.cloudflare.com/containers/pricing/);
running Renovate in a Cloudflare container is not a documented Renovate setup.

- An always-on 1 vCPU / 4 GiB container is about 10.5 M GiB-s of memory a
  month. That is roughly $26/month after the 25 GiB-hours included.
- A cron-driven OSS run bills only while it runs.

Any server or VM GETQUICK already runs would also work. Either way it is a
second runtime, beside the CI Worker, to patch and monitor.

### B. Mend-hosted Renovate

Mend runs the job and the scheduling.

- **Free (Community Cloud).** "Free users cannot modify nor request arbitrary
  commands for `postUpgradeTasks`." It can't run `gq sync` at all. It is
  usable only together with option C.
- **Community (OSS).** "Trusted Open Source projects" can request an
  allowlisted command. "Acceptance is at the discretion of Mend." The plan is
  for OSI-licensed projects, and site repositories are private client code. My
  reading is that they aren't eligible.
- **Enterprise Cloud (paid).** Paying customers can set
  `RENOVATE_ALLOWED_COMMANDS` at the repository or organization level, for
  example `["^make tidy$"]`. Pricing is through sales@mend.io and isn't
  published.

  On the requirements, Enterprise Cloud matches A for R1, R3, R4 and R5. On R2
  the execution environment and its credentials belong to Mend. Mend says it
  hardens it "more than a typical Renovate deployment", but GETQUICK can't
  inspect or scope it.

  Limits per plan
  ([overview](https://docs.renovatebot.com/mend-hosted/overview/#resources-and-scheduling)):

  | Plan       | Concurrent jobs per org | Scheduling | CPU / memory  | Timeout |
  | ---------- | ----------------------- | ---------- | ------------- | ------- |
  | Free       | 1                       | every 4 h  | 1 vCPU / 3 GB | 30 min  |
  | OSS        | 2                       | every 4 h  | 1 vCPU / 6 GB | 60 min  |
  | Enterprise | 16                      | hourly     | 2 vCPU / 8 GB | 60 min  |

  At fleet scale, Free's single concurrent job per organization matters as much
  as its command ban.

### C. Renovate (any hosting) plus a trusted, isolated Cloudflare CI write-back

Renovate (Mend Free is enough) opens the plain dependency PR. A Cloudflare
Worker sees the PR, verifies it, runs `gq sync` in a sandbox with no
credentials, and writes the result back as a separate commit.

**What exists today.**

- **Ekis already has the verification front half.** Its
  [Revision Verification](https://github.com/Quick-Release/ekis/blob/ce258d8/docs/runbooks/revision-verification.md)
  module does the following:
  - It accepts HMAC-signed webhooks from a repository-scoped GitHub App
    (Contents read, Checks write, Pull requests read, Metadata read) and
    rejects any event whose owner or repo doesn't match its configuration.
  - It deduplicates `X-GitHub-Delivery` and treats a cross-repository head as a
    fork, gated behind a check-run "Approve and run" that only `maintain` or
    `admin` can press.
  - It fetches one exact SHA with a short-lived installation token and asserts
    `git rev-parse HEAD` equals that SHA. It pushes the commit unchanged to
    `github/pr-<n>/<sha>` in Artifacts and confirms the Artifacts ref equals
    the SHA.
  - It reports the result as an `EKIS CI` check on that SHA. A newer head
    cancels a superseded run, and outages fail closed.
  - App credentials stay in Worker secrets and "never cross the runner seam"
    ([`mirror.ts`](https://github.com/Quick-Release/ekis/blob/ce258d8/apps/cloudflare-ci/src/revision-verification/mirror.ts),
    [`service.ts`](https://github.com/Quick-Release/ekis/blob/ce258d8/apps/cloudflare-ci/src/revision-verification/service.ts),
    [`model.ts`](https://github.com/Quick-Release/ekis/blob/ce258d8/apps/cloudflare-ci/src/revision-verification/model.ts)).
- **The blueprint template doesn't have it yet.**
  [`infra/ci/`](../../blueprint/templates/infra/ci/) mirrors a ref "as GitHub
  has it _now_ (not as the webhook saw it)" using a fine-grained PAT (Contents
  read, Commit statuses write). It posts a `cloudflare-ci` commit status for
  whatever SHA the run got. So it isn't tied to an exact revision, and it has
  no idea of which App or user caused the event. Option C needs the template to
  adopt Ekis's module, or its equivalent, first.
- **`@cloudflare/ci` 0.2.0 doesn't write back to GitHub.** It has a "Fix
  Branch" seam (`getPushCredentials`, `createPullRequest`). But only the
  Artifacts provider implements push credentials (a one-hour Artifacts write
  token), and `createPullRequest` defaults to `skipped`. The
  `sourceControlCredentials` runner option injects Artifacts credentials, not
  GitHub ones. So writing back to GitHub is custom Worker code.

**The write-back half (to build).** These are the GitHub facts that make it
safe:

- **Commit through the API, not `git push` from the runner.** GraphQL
  `createCommitOnBranch` takes `fileChanges` and `expectedHeadOid` ("the git
  commit oid expected at the head of the branch prior to the commit").
  - That is a compare-and-swap on the verified SHA: if Renovate rebased in the
    meantime, the write fails and nothing is overwritten.
  - Its commits "are automatically signed by GitHub if supported and will be
    marked as verified". They are authored by the credential's owner, which
    here is the generation App.
- **Separate identities.** The token is a GitHub App installation token. It
  "will expire after 1 hour", and it can be narrowed per request to
  `repositories` and `permissions` (here, one repo and `contents: write`). It
  belongs to a _generation_ App, distinct from the CI App that reports checks
  and from any deploy credential. The token stays in the Worker. The sandbox
  returns a patch, or the list of changed files and their contents.
- **Paths are checked in the Worker.** GitHub has no per-actor path allowlist.
  Push-ruleset "Restrict file paths" _blocks_ paths for every pusher, and only
  in private or internal repositories. So the Worker compares the sandbox's
  changes against the allowlist from the new package's `ownership.json` plus
  the fixed paths, and refuses the commit if anything falls outside it.
- **Rerun.** A new commit on the PR branch is a new head SHA, and required
  checks attach to SHAs. So the generated commit starts with no result, and
  merging waits until CI reports on it.
  - Ekis's module starts a run on `pull_request` `synchronize`. Whether a
    commit created by an App token triggers that webhook should be confirmed in
    an observation drill; I found no GitHub doc that says so either way for
    App-authored API commits.
  - If it doesn't, the Worker can start verification of the new SHA directly,
    since it already knows it.

**Verification checklist for this option**, mapped to R1:

| What               | How                                                                                                                                                                                                                                                                                                                                   | Evidence                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Event authenticity | HMAC `X-Hub-Signature-256`, dedupe `X-GitHub-Delivery`, installation id                                                                                                                                                                                                                                                               | Ekis `service.ts`                                              |
| Repository         | Event owner/repo equals the configured repo; head repo equals base repo (not a fork)                                                                                                                                                                                                                                                  | Ekis `model.ts`                                                |
| Bot                | PR author and every head commit's author are the expected App account. Use the numeric id, e.g. `renovate[bot]` = 29139614 (from `GET /users/renovate[bot]`), not the login. Head commits are `verification.verified` (Renovate App commits are platform-signed). GitHub warns not to treat `sender` as proof of who caused an event. | GitHub REST users API; Renovate `platformCommit`; webhook docs |
| Dependency change  | `compare base...head` touches only dependency manifests and lockfiles. `@getquick/site` is the changed dependency and resolves to a published version and integrity.                                                                                                                                                                  | to build                                                       |
| Exact revision     | Fetch by SHA, assert `HEAD == sha`, write with `expectedHeadOid = sha`                                                                                                                                                                                                                                                                | Ekis `mirror.ts`; GraphQL schema                               |

**Against the requirements**

- **R1, fully met, with checks that can be inspected.** This is the only option
  where R1 is something to implement, and it is also the only one where it can
  be audited.
- **R2, strongest.** Generation runs in a disposable sandbox with no GitHub
  token and no Cloudflare deploy or Ploi secrets. It holds at most a read-only
  registry token for `pnpm install`. Today the template's CI Worker binds
  `PLOI_API_TOKEN` and deploy credentials for its tag release step.
  `@cloudflare/ci` injects only the secrets a runner names, but the Worker
  still holds them. Isolating them fully means a generation Worker separate
  from the deploying Worker. That is part of the Authority scoping item on #18.
- **R3, enforced by the Worker against the ownership list,** not by
  repository config.
- **R4, met by a new SHA.** It costs a second CI run per update PR: once on
  Renovate's commit, which fails or is meaningless before sync, and once on
  the generated commit.
- **R5, met.** It extends the CI Worker GETQUICK already runs.

**Interactions with Renovate to configure.**

- **`gitIgnoredAuthors`.** "By default, Renovate will treat any PR as modified
  if another Git author has added to the branch", and then "won't perform any
  further commits". The generation App's commit email must be listed there.
  Otherwise Renovate stops rebasing and updating every PR that got generated
  output.
- **Rebases drop the generated commit.** When Renovate rebases or recreates its
  branch, the generated commit is gone and the new head must be generated
  again. Generation is deterministic and idempotent, so redoing it per head SHA
  is safe. Supersession, as in Ekis's module, avoids duplicate work.
- **Generate before the merge decision.** With automerge, nothing must merge on
  Renovate's ungenerated commit. Make generation itself a required check that
  fails while output is pending: `gq sync --check` exits 1 when there are
  changes.

**Cost and hosting.** It runs on the existing Workers Paid account: a Workflow
plus one sandbox step per update PR. One illustrative run: 1 vCPU / 4 GiB for
2 minutes is 480 GiB-s, about $0.0012 beyond the included 25 GiB-hours.
Workflows bill CPU time, requests, storage and steps, and idle waiting isn't
billed. Artifacts begins billing on 2026-10-14: 10,000 operations and 1 GB a
month are included, then $0.15 per 1,000 operations and $0.50 per GB-month.
Renovate itself can stay on Mend Free, which costs nothing. The real cost is
engineering: building the write-back half and porting Revision Verification
into the template.

## Comparison

|                                    | A. Self-hosted Renovate + `postUpgradeTasks`                | B. Mend-hosted Renovate                                           | C. Renovate + Cloudflare CI write-back          |
| ---------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| Can run `gq sync`                  | Yes, once allowlisted                                       | Free: no. OSS: discretionary (likely ineligible). Enterprise: yes | Yes                                             |
| R1 verify bot/repo/change/revision | Built in (no outside trigger)                               | Built in (Enterprise)                                             | Must build: Ekis has the bot/repo/revision half |
| R2 no production credentials       | No deploy secrets, but runs beside a multi-repo write token | Mend's environment; not inspectable                               | Credential-free sandbox; token stays in Worker  |
| R3 restrict write paths            | `fileFilters` (repository config, filters the commit)       | Same                                                              | Enforced by Worker against `ownership.json`     |
| R4 checks rerun                    | One commit, one CI run                                      | One commit, one CI run                                            | New SHA, second CI run; confirm trigger         |
| R5 Cloudflare CI                   | Checks only; Renovate is a second runtime                   | Checks only                                                       | Native                                          |
| Extra Renovate config              | `allowedCommands`, `fileFilters`, `executionMode`           | `RENOVATE_ALLOWED_COMMANDS`                                       | `gitIgnoredAuthors`                             |
| Cost                               | Hosting plus operations; CE needs always-on hosting         | Enterprise: sales pricing                                         | Pennies per run plus build effort               |
| Fleet scale                        | One App/instance per org                                    | Free: 1 concurrent job per org                                    | Per-site or shared CI Worker (open, #18)        |

## Open questions to settle in #34

1. **Template or Ekis CI.** The blueprint CI template lacks exact-revision
   verification. Does option C wait for the template to adopt Ekis's Revision
   Verification? If A or B is chosen, is it still wanted for R1?
2. **Registry token.** Whether `@getquick/site` is private decides whether the
   generation sandbox needs a registry token. That token would be read-only.
3. **One Worker or two.** Does generation share a Worker with deployment? That
   would leave deploy secrets bound beside it. Or does it get its own Worker
   and GitHub App? This ties into Authority scoping and the shared-CI-Worker
   question.
4. **Fleet operations.** Is Renovate a fleet-wide service GETQUICK operates
   (A), or one that Mend operates (B and C)? Mend Free's single concurrent job
   per org sets the pace across hundreds of sites.
5. **Webhook trigger.** Does an App-authored `createCommitOnBranch` commit
   trigger `pull_request.synchronize` for the CI App? This needs a drill before
   anyone relies on it.
