# Fleet capacity: per-site footprint and provider limits

> Research snapshot: 2026-10-02, for [#24](https://github.com/Quick-Release/getquick-site/issues/24) on the [phase 4 map (#18)](https://github.com/Quick-Release/getquick-site/issues/18). It informs the "Fleet inventory, isolation, and capacity" section of the [blueprint rollout plan](../plans/getquick-blueprint-rollout.md#fleet-inventory-isolation-and-capacity). It records facts and arithmetic only. Placement decisions belong to later tickets.
>
> **Method.** The footprint comes from this repository's provisioning code and templates, plus the committed config of Lombardi and Ekis (`/data/code/getquick/clients/{lombardi,ekis}`). Provider limits come from first-party docs, read on 2026-10-02. Each source's "last updated" date is given next to it.
>
> **What this is not.** No mutating calls were made, and no secrets were read. Live inventory counts were not taken. A read-only Ploi API listing was blocked by the session's permission policy, and no Cloudflare API was called. See [Open items](#open-items).

## Summary

- **Per site (the blueprint content layout, as Lombardi and `gq-smoke` run it):**
  - 2 Workers, 2 Workflows, 1 Durable Object class and 1 Container application with its image.
  - 1 Artifacts namespace and repository.
  - 3 R2 buckets.
  - 6 account-owned API tokens.
  - 1 Worker custom domain and 1 R2 custom domain on the zone.
  - On Ploi: 1 system user, 1 site and 1 database.
- **First ceiling on one Cloudflare account: Container image storage.**
  - The limit is 50 GB per account.
  - Each site's CI Worker pushes its own CI image, about 1.2–1.45 GB uncompressed.
  - That allows only about 34 sites, and fewer if old image tags are kept.
  - The docs don't say whether this is measured compressed or with layers shared. Measure it before relying on the number.
- **Second ceiling: account-owned API tokens.**
  - The limit is 500 per account, with no documented way to raise it.
  - At 6 per site that is about 83 sites.
  - It halves to about 41 if every site rotates its tokens blue-green at the same time, the way Ekis does.
- **Third ceiling: Worker custom domains.** There are 100 per zone, and every staging site shares `bnq.pt`. That is 100 blueprint sites, or 50 Ekis-like sites.
- **Fourth ceiling: Workers per account.** The limit is 500 on Workers Paid and can be raised. That is about 249 blueprint sites, or about 166 with a separate staging Frontend stage.
- **Artifacts and R2 don't bind.** Artifacts allows unlimited repositories, and R2 allows 1,000,000 buckets.
- **Workers for Platforms** removes the Workers-count ceiling: unlimited scripts, $25/mo, 1,000 scripts included. It does not touch the token, image-storage or zone ceilings.
- **Ploi:**
  - Sites are unlimited on every paid plan.
  - Servers are capped at 5 (Basic) or 10 (Pro).
  - Automatic backups need Pro or above.
  - The API is limited to 60, 120 or 240 requests per minute by plan.
  - No limit on sites or system users per server is documented, so the server's own resources are the real limit.
- **Marginal cost per site is almost all usage.**
  - On Cloudflare, Workers Paid is $5 per account, not per site. R2, Artifacts and Containers come with free allowances shared across the account. The only per-site spend is CI container time, about $0.002 per container-minute for the blueprint instance.
  - On Ploi, the plan fee is flat. The server's hosting bill, which Ploi doesn't include, is the cost that grows with sites per server.

## Per-site footprint

### Blueprint content layout (Lombardi, `gq-smoke`)

This is derived from `gq.ops.json` and the commands that provision it:

- [`scripts/smoke/gq-smoke-up.sh`](../../scripts/smoke/gq-smoke-up.sh), stages "Fill in gq.ops.json", "Ploi site" and "Cloudflare resources"
- [`src/cloudflare/`](../../src/cloudflare/)
- [`src/ploi/provision.mjs`](../../src/ploi/provision.mjs)
- [`blueprint/templates/infra/`](../../blueprint/templates/infra/)

Lombardi's committed [`gq.ops.json`](https://github.com/Quick-Release/lombardi/blob/main/gq.ops.json) and `infra/ci/wrangler.jsonc` match this layout one-to-one.

| Resource | Count | Names (`<p>` = project) | Source |
|---|---|---|---|
| Worker: Frontend | 1 (prod) | `<p>-fe` on `domains.frontend` | `infra/frontend.run.ts`. Each extra Alchemy stage adds `<p>-fe-<stage>`. |
| Worker: CI | 1 | `<p>-ci` (`ci.worker`), `workers_dev: true` | `infra/ci/wrangler.jsonc` |
| Workflows | 2 | `<p>-ci`, `<p>-mirror` | `infra/ci/wrangler.jsonc` |
| Durable Object class | 1 | `CiSandbox` (SQLite) | `infra/ci/wrangler.jsonc` |
| Container application and image | 1 app; 1 image per `ci:deploy` | `<p>-ci-cisandbox`. 1 vCPU / 4 GiB / 8 GB, `max_instances: 6`. | `infra/ci/wrangler.jsonc`, `infra/ci/Dockerfile` |
| Event subscription | 1 | `cf.artifacts.repo.pushed` → `<p>-ci` Workflow | `infra/ci/wrangler.jsonc` |
| Artifacts | 1 namespace, 1 repo | `artifacts.namespace` / `artifacts.repo` = `<p>` | `src/cloudflare/ci.mjs` |
| R2 buckets | 3 | `<p>-releases` (CMS release archives under `admin/` and DB backups under `db/`), `<p>-media` (public, custom domain), `<p>-ci-backups` | `gq.ops.json`; `src/cloudflare/{releases,media,ci}.mjs` |
| R2 custom domain | 1 | `media.domain` | `src/cloudflare/media.mjs` |
| Worker custom domain | 1 | `domains.frontend` | `infra/frontend.run.ts` |
| Account-owned API tokens (persistent) | 6 | `GETQUICK <P> Staging Alchemy`, `… Releases R2`, `… Media R2`, `… Artifacts`, `… CI Backups R2`, `… CI Deploy` | `src/cloudflare/{deploy-token,releases,media,ci}.mjs`. Created through `/accounts/{id}/tokens` (`src/cloudflare/client.mjs`). |
| Account-owned API tokens (transient) | 0 at rest; 1 at a time during setup | `GETQUICK <P> <purpose> bucket setup (temporary)`, 1-hour expiry, deleted in `finally` | `src/cloudflare/tokens.mjs` `withTemporaryToken` |
| GitHub | 1 repo, 1 webhook, 1 fine-grained PAT | `<p> CI` PAT (Contents read, Commit statuses write) | `gq-smoke-up.sh` stage "GitHub → CI Worker" |
| Sigillo | 1 project, 3 environments | `dev`, `ops`, `staging` | `gq.ops.json` `sigillo` |
| Ploi system user | 1 | `ploi.systemUser` = `<p>`, no sudo | `src/ploi/provision.mjs` |
| Ploi site | 1 | `domains.admin`, custom deployments (no git) | `src/ploi/provision.mjs` |
| Ploi database and DB user | 1 + 1 | `<p>_staging` | `src/ploi/provision.mjs` |
| Ploi server | shared | `gq-smoke` runs on Lombardi's server (`ploi.serverId` 102329) | `gq-smoke-up.sh` header |

Some resources are shared and are paid once per account or per fleet, not per site:

- the `alchemy-state-store` Worker that `Cloudflare.state()` deploys (alchemy 2.0.0-beta.79, `lib/Cloudflare/StateStore/Api.js`)
- the account token-manager token `CLOUDFLARE_TOKEN_MANAGER_API_TOKEN`, which `gq-smoke-up.sh` copies from Lombardi's Sigillo
- the Ploi API token
- the staging zone `bnq.pt`

There is no staging Worker today. The Frontend deploys only the `prod` stage (`infra/scripts/deploy-frontend.mjs`), and Lombardi and `gq-smoke` are themselves the staging environment on `bnq.pt`. Giving every site a staging and a production Frontend adds 1 Worker and 1 custom domain per site. A per-environment CMS adds 1 Ploi site, 1 database and probably 1 system user.

### Commerce layout (Ekis, before adoption)

Ekis predates the blueprint layout ([ADR 0008](https://github.com/Quick-Release/ekis/blob/main/docs/adr/0008-getquick-site-blueprint.md)). Its committed `gq.ops.json` leaves `ploi.serverId`/`siteId` and `cloudflare.zoneId` empty, and those values come from `.env`/Sigillo. The counts below come from its code:

| Resource | Count | Names | Source |
|---|---|---|---|
| Workers | 3, plus 1 drill | `ekis-storefront`, `ekis-docs`, `ekis-ci`; `ekis-ci-drill` | `infra/frontend.run.ts`, `infra/docs.run.ts`, `apps/cloudflare-ci/wrangler{,.drill}.jsonc` |
| Workflows | 1 (+1 drill) | `ekis-ci` | `apps/cloudflare-ci/wrangler.jsonc` |
| Durable Object classes | 2 (+2 drill) | `CiSandbox`, `RevisionVerificationState` | same |
| Container application | 1 (+1 drill) | `standard-4` (4 vCPU / 12 GiB / 20 GB per the Containers docs), `max_instances: 5` | same |
| Artifacts | 1 namespace `ekis-ci` (+ `ekis-ci-drill`), repo `ekis` | | same |
| R2 buckets | 2 named, plus the Ploi backup target | `ekis-media`, `ekis-ci-cache` (EU jurisdiction). The Ploi backup bucket name comes from `PLOI_R2_BUCKET` and isn't committed. | `scripts/cloudflare/cloudflare-r2-media-setup.mjs`, `apps/cloudflare-ci/wrangler.jsonc`, `scripts/ploi/ploi-backup-target.mjs` |
| Worker custom domains | 2 | `ekis.bnq.pt`, `ekis-docs.bnq.pt` | `infra/*.run.ts` |
| Account-owned API tokens | about 4 at rest, up to about 7 during rotation, plus a token-manager token | `GETQUICK EKIS CI Infrastructure <ver>`, `… CI Artifacts Push <ver>`, `… CI Cache R2 <ver>` (blue-green: the new set is minted before the old one is deleted), the Alchemy `CLOUDFLARE_API_TOKEN`, and an Ekis-owned token manager | `scripts/cloudflare/cloudflare-ci-token-rotation.mjs`, `docs/sigillo.md` |
| Other Cloudflare | Turnstile widget, WordPress cache-purge token | | `docs/turnstile-provisioning.md`, `docs/sigillo.md` |
| Ploi | 1 site (`ekis-admin.bnq.pt`), 1 database. The system user defaults to the shared `ploi` user, and a migration to a dedicated user is scripted. | | `scripts/ploi/ploi-setup.mjs`, `scripts/ploi/ploi-user-*.mjs` |

Ekis and Lombardi share one Cloudflare account. Both `gq.ops.json` files carry the same `cloudflare.accountId`.

### Sizes measured locally

- **CI images.** Uncompressed image sizes in the local Docker cache (`docker images`) are about 1.45 GB for `lombardi-ci-cisandbox` and 1.08–1.19 GB per `ekis-ci-cisandbox` tag. Several Ekis tags are present, which suggests that every `ci:deploy` pushes a new tag.
- **Git repositories.** The packed git size is 1.35 MiB for Lombardi and 1.82 MiB for Ekis (`git count-objects -vH`). That is far below the 1 GB per-repo Artifacts limit.

## Provider limits (verified 2026-10-02)

### Cloudflare

| Limit | Value | Raisable? | Source (last updated) |
|---|---|---|---|
| Workers per account | Free 100, **Paid 500** | Yes, via the Limit Increase Request Form. The docs point to Workers for Platforms beyond that. | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (2026-09-05) |
| Custom domains per zone | 100 | not stated | same |
| Routes per zone | 1,000 | not stated | same |
| Cron triggers per account | Free 5, Paid 250 | | same |
| Worker size | 64 MiB | | same |
| Workers Paid plan | $5/mo per account; 10M requests and 30M CPU-ms included | | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (2026-10-02) |
| Workers for Platforms | $25/mo; **unlimited scripts**, 1,000 included then $0.02/script; 20M requests, 60M CPU-ms included. "No per-account script limits apply to Workers in a namespace." Use one namespace per environment, "not per customer". No gradual deployments for user Workers. | | [WfP pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/platform/pricing/) (2026-04-21), [WfP limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/platform/limits/) (2026-07-03), [How WfP works](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/how-workers-for-platforms-works/) (2026-04-21) |
| Durable Object classes per account | Free 100, **Paid 500** | | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (2026-06-01) |
| Workflows | Concurrent instances per account: Free 100, Paid 50,000. Creation: 300/s per account, 100/s per workflow. No cap on the number of Workflows is documented. | | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) (2026-09-21) |
| Containers, per account | Concurrent vCPU 1,500; concurrent memory 6 TiB; concurrent disk 30 TB; **total image storage 50 GB** (delete images with `wrangler containers delete`) | not stated | [Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/) (2026-09-30) |
| Containers pricing | Per 10 ms running. Memory: 25 GiB-h included, then $0.0000025/GiB-s. CPU (active only): 375 vCPU-min included, then $0.000020/vCPU-s. Disk: 200 GB-h included, then $0.00000007/GB-s. | | [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/) (2026-08-28) |
| Artifacts | Open beta since 2026-10-01; Workers Paid only. **Unlimited repos and namespaces**. 1 GB per repo; 32 MB per blob; 1 TB per account (raisable); 2,000 control-plane requests per 10 s per namespace; 2,000 git requests per 10 s per repo. Billing starts 2026-10-14: 10,000 ops/mo and 1 GB-mo included, then $0.15 per 1,000 ops and $0.50/GB-mo. | 1 TB only | [Artifacts limits](https://developers.cloudflare.com/artifacts/platform/limits/) (2026-10-01), [Artifacts pricing](https://developers.cloudflare.com/artifacts/platform/pricing/) (2026-10-01) |
| R2 buckets per account | **1,000,000**. Older docs said 1,000; re-checked against the page's Markdown on 2026-10-02. | Yes (form) | [R2 limits](https://developers.cloudflare.com/r2/platform/limits/) (2026-06-08) |
| R2 other | 100 custom domains per bucket; 50 bucket-management ops/s; storage and objects per bucket unlimited | Yes (form) | same |
| R2 pricing | Standard storage $0.015/GB-mo, Class A $4.50/M, Class B $0.36/M, free egress. Free tier: 10 GB-mo, 1M Class A, 10M Class B per month, per account. | | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) (2026-10-01) |
| API tokens | **500 account-owned tokens per account**; 50 user tokens per user. API rate limit: 1,200 requests per 5 min per user/token, and 200 req/s per IP. | No route documented; only Enterprise can raise the rate limit | [API limits](https://developers.cloudflare.com/fundamentals/api/reference/limits/) (2026-08-25) |
| Zones | Adding is throttled to 25 per 10 min. Over 50 zones, an account can't add more while more are pending than active. No cap on Free zones is documented. | | [Add multiple sites](https://developers.cloudflare.com/fundamentals/manage-domains/add-multiple-sites-automation/) (2026-05-05) |

Workers Builds limits were also checked: concurrent builds Free 1 / Paid 6, and build minutes Free 3,000 / Paid 6,000 per month ([Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), 2026-05-29). They don't apply. The fleet's CI runs on its own Worker, Workflows and Containers, not on Workers Builds.

### Ploi

[Pricing](https://ploi.io/pricing) has no date on the page. The rate-limiting page, [developers.ploi.io/getting-started/rate-limiting](https://developers.ploi.io/getting-started/rate-limiting), has no date either.

| | Free | Basic | Pro | Unlimited |
|---|---|---|---|---|
| Price (monthly; yearly saves 10%) | €0 | €8 / $10 | €13 / $16 | €30 / $36 |
| Servers | 1 | 5 | 10 | unlimited |
| Sites | 1 | unlimited | unlimited | unlimited |
| Deployments | 5 per month | unlimited | unlimited | unlimited |
| Website isolation (system users) | no | yes | yes | yes |
| Automatic DB and file backups | no | no | yes | yes |
| Team management | no | no | no | yes |
| API rate limit | no API | 60/min | 120/min | 240/min |

Other Ploi limits:

- **Server fees** are not included in Ploi's prices.
- **Backups.** They need Pro or Unlimited, and on a team the owner's plan counts. Database backups can run every 10–60 minutes or less often. A run longer than 60 minutes is stopped. Source: [Backups docs](https://ploi.io/documentation/database/how-do-i-set-up-database-and-file-backups), last updated 2026-09-29.
- **Isolation.** Each isolated site gets its own Linux user, SSH key and PHP-FPM pool. Source: [Website isolation](https://ploi.io/features/website-isolation), no date.
- **Sites and system users per server.** No limit is documented on the pricing page, the feature pages or the docs.

## Where each limit binds

The scenario is one Workers Paid account and N sites. Rows are in order of the fleet size at which they bind.

| Limit | Per-site use (blueprint / Ekis-like) | Binds at N ≈ | Notes |
|---|---|---|---|
| Container image storage, 50 GB | 1 image, about 1.2–1.45 GB, more with retained tags | **about 34** (blueprint, 1 image each); about 17 if 2 tags are kept | Measurement basis (compressed? layers deduplicated across sites with the same base?) is undocumented. Shared or deduplicated CI images, or one shared CI Worker, would remove this ceiling. |
| Account-owned API tokens, 500 | 6 / about 4 (about 7 while rotating) | **about 83** (blueprint); about 41 if every site rotates at once | No documented way to raise it. Shared CI, or fewer and broader per-site tokens, change this directly. |
| Worker custom domains per zone, 100 | 1 / 2 on the shared staging zone | **100** / 50 on `bnq.pt` | Moot once each site's production frontend lives on its own client zone |
| Workers per account, 500 (raisable) | 2 / 3 (+1 drill), +1 per extra Frontend stage | **about 249** / about 166 (about 166 / about 124 with staging) | 1 Worker is reserved for `alchemy-state-store`. Workers for Platforms removes this limit. |
| Containers concurrent vCPU, 1,500 | peak 6 × 1 vCPU / 5 × 4 vCPU | about 250 / about 75, if every site hits `max_instances` at once | Realistic concurrency is far lower |
| Durable Object classes, 500 | 1 / 2 | 500 / 250 | |
| Ploi API, 60–240 requests per minute | fleet polling | depends on the controller design | Example: a 1-request-per-site health poll every minute allows 60–240 sites per Ploi account |
| Ploi servers, 5 (Basic) or 10 (Pro) | shared | sites ÷ sites-per-server | The per-server limit is server RAM and CPU, not Ploi |
| Artifacts repos, R2 buckets, Workflows | 1 / 3 / 2 | not binding | Artifacts is in open beta, and billing starts 2026-10-14 |

The Workers-count limit is the one the plan names, but it is the fourth ceiling, not the first. CI image storage and the token count bind well before it. Both come from the per-site CI Worker and per-site tokens, so the per-site vs. shared CI choice in the plan matters more than account partitioning or Workers for Platforms.

## Cost per site (marginal, usage-based)

- **Cloudflare fixed cost.** $0 per site. Workers Paid is $5/mo per account. Workers for Platforms, if adopted, is $25/mo per account.
- **CI compute.** This is the blueprint instance (1 vCPU / 4 GiB / 8 GB) at the published rates:
  - Memory: 4 × $0.0000025 × 60 ≈ $0.0006 per container-minute.
  - Active CPU: up to $0.0012 per container-minute.
  - Disk: about $0.00003 per container-minute.
  - Total: **≤ about $0.002 per container-minute**, before the Paid allowance shared across the account (25 GiB-h memory, 375 vCPU-min CPU).
  - Ekis's `standard-4` is roughly 3–4× that per container-minute.
- **R2, Artifacts and Workers requests.** These stay within the account's shared free allowances at today's sizes: repos under 2 MiB packed, small media libraries. Past those allowances they are a few cents per site per month.
- **Ploi.** The plan fee is flat per account, from €8 to €30 per month. Per-site cost is the server bill divided by the sites per server. Neither the server price nor the current plan is recorded in this repository.

## Open items

These need a human or a permitted read-only session:

1. **Live Ploi inventory.** Count servers, system users, sites and databases, and identify the current Ploi plan. Use `gq ploi servers list` and `gq ploi sites list` with Lombardi's token. That read was blocked in this session. Ekis's server and site IDs live only in its `.env` and Sigillo.
2. **Live Cloudflare inventory.** Count Workers, account-owned tokens and Container image storage on the shared account. Use read-only `wrangler containers images list` and token list calls. The image-storage figure decides whether the 34-site estimate holds.
3. **Image tag cleanup.** [`src/ci/deploy.mjs`](../../src/ci/deploy.mjs) never deletes a previous image (it has no `containers`/`delete` call), so unless Cloudflare garbage-collects them, image storage grows with every `gq ci deploy`. Confirm against the live image list.
