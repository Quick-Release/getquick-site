# Ekis adoption dry run: what `gq sync` would change

> Research snapshot: 2026-10-02, for [#19](https://github.com/Quick-Release/getquick-site/issues/19)
> on the [phase 4 map (#18)](https://github.com/Quick-Release/getquick-site/issues/18). It records
> facts only and makes no decision. The decisions it feeds are
> [#28, what the commerce variant manages](https://github.com/Quick-Release/getquick-site/issues/28),
> [#29, which Ekis tooling must be shared](https://github.com/Quick-Release/getquick-site/issues/29),
> and [#30, CMS code activation and rollback](https://github.com/Quick-Release/getquick-site/issues/30).
>
> **Inputs:** Ekis `main` at
> [`ce258d8`](https://github.com/Quick-Release/ekis/commit/ce258d86b7a9cb9b55e9d362e55a038162ce2316)
> (2026-09-27, "Merge pull request #44"). `@getquick/site` **0.13.1** (this repository at
> `45d372d`). The published npm `0.13.1` (`latest`) was used to run `gq`. Its `bin/`, `src/`,
> `blueprint/` and `schema/` are byte-identical to a `pnpm pack` of `45d372d`. The two tarballs differ
> only in `package.json` key order and `packageManager`, and in the published one also shipping
> `docs/research/README.md`.
>
> **Method:** a throwaway worktree of Ekis, never pushed or deployed, and removed afterwards.
> `gq sync` was run against it with `node <published package>/bin/gq.mjs`. Before running it, the
> source was read to check that it touches nothing live. `runCli` hands `runSyncCommand` only
> `{ cwd, io }`, with no `fetch`, `exec` or `lookup`
> ([src/ops/cli.mjs](../../src/ops/cli.mjs), [src/sync/commands.mjs](../../src/sync/commands.mjs)).
> The only code it runs from the site is `import()` of `shop-devtools.config.mjs`
> ([src/manifest/release-config.mjs](../../src/manifest/release-config.mjs)), and Ekis's module is a
> plain object literal. No provider API, Ploi server, database or Sigillo project was contacted, and
> Ekis's `.env` was not read. The Ploi IDs and the live deploy script are therefore not checked here.
> No credentials or customer data are recorded.

## Summary

- **Neither the `gq sync --check` nor the `gq sync` step runs cleanly on Ekis as it stands.**
  1. Without `--variant`, `--check` stops at "schema v0 → v1 pending". It plans no files.
  2. With `--variant commerce`, the release-config fold refuses two keys, `docsChangelogPath` and
     `deploys`, and nothing is written.
  3. Once those were removed in the throwaway, the check lists 10 managed paths that Ekis has
     "edited": `admin.sh`, the pre-commit hook, three `docs/agents/*` files, `infra/frontend.run.ts`,
     `infra/package.json`, `infra/scripts/deploy-frontend.mjs`, `vite.config.ts`, and 19 root
     `package.json` script keys. `gq sync` refuses to write anything while any of them stays edited.
- **The migrated manifest keeps only identity and domains.** It drops `credentials` (29 fields),
  `github.environment`, `github.secrets` (5) and `github.variables` (22). The `ploi` IDs are empty
  strings. Nothing gives the v1 blocks the generated files read (`ploi.*` beyond the IDs,
  `wordpress.plugins`, `releases`, `media`, `backups`, `artifacts`, `ci`, `local`). The commerce
  variant has no defaults ([src/manifest/site-settings.mjs](../../src/manifest/site-settings.mjs)),
  so all of Ekis's release and verify settings are carried as additions.
- **The blueprint's generated output is the content site's, and much of it doesn't fit Ekis.**
  - `infra/frontend.run.ts` becomes an Astro website named `ekis-fe` with no secrets, rate limiters or
    Turnstile. Ekis's storefront is TanStack Start on Vite, the `ekis-storefront` Worker.
  - `infra/package.json` loses the docs stack scripts and switches to `catalog:` entries that Ekis's
    `pnpm-workspace.yaml` (create-once, so left alone) doesn't have.
  - `infra/ci/` would be generated as a second CI Worker next to `apps/cloudflare-ci`, with every
    name rendered as a `<placeholder>`.
  - The CMS deploy script is release-archive based and activates no plugins, because
    `wordpress.plugins` is empty.
- **A forced `gq sync` would break existing behaviour.** The conflicting files were deleted and the 19
  keys removed in the throwaway, so this was measured by running it. `ci:check`, which Ekis's
  Cloudflare CI runs, becomes `tsc` of `infra/ci`. The pre-commit hook calls `pnpm check`, which Ekis
  doesn't define. `ploi:deploy`, Ekis's deploy, would hit a script that exits without `ARCHIVE_URL`
  and reports `EKIS_DEPLOY_STATUS`, while Ekis waits for `GETQUICK_DEPLOY_STATUS`. A second
  `gq sync --check` then reported nothing pending (exit 0), so the sync is idempotent once applied.

## 1. The manifest migration (v0 → v1)

Command output, `gq sync --check` with no flags (exit 1). This is all it says: a v0 manifest without a
recorded variant can't be planned further.

```text
gq.ops.json: schema v0 → v1 pending. Run gq sync --manifest --variant <content|commerce> to apply it.
shop-devtools.config.mjs: folding into gq.ops.json pending. Run gq sync --manifest --variant <content|commerce> to apply it.
```

With `--variant commerce` (exit 1, nothing written):

```text
warning: gq.ops.json dropped credentials: gq no longer writes provider credentials to .env.
warning: gq.ops.json dropped github.environment: gq no longer syncs GitHub Actions secrets and variables.
warning: gq.ops.json dropped github.secrets: gq no longer syncs GitHub Actions secrets and variables.
warning: gq.ops.json dropped github.variables: gq no longer syncs GitHub Actions secrets and variables.
gq: Can't fold shop-devtools.config.mjs into gq.ops.json: docsChangelogPath is not supported: the docs
changelog page was dropped with shop-devtools; deploys is not supported: releases deploy from Cloudflare CI.
Change it, then run gq sync --manifest again.
```

`foldReleaseConfig` refuses these keys by name
([src/manifest/release-config.mjs](../../src/manifest/release-config.mjs) `UNSUPPORTED`). In the
throwaway only, they were deleted from `shop-devtools.config.mjs`. `gq sync --manifest --variant
commerce` then migrated the manifest, folded the module in, and removed it, adding one more warning:
`dropped releaseBranch: gq releases the branch that is checked out.`

### Key by key

| v0 key (Ekis)                                  | v1 result               | Notes                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project: "ekis"`                              | kept                    |                                                                                                                                                                                                                                                                                                                                                                                               |
| (none)                                         | `variant: "commerce"`   | v0 never recorded it; `--variant` is required                                                                                                                                                                                                                                                                                                                                                 |
| `sigillo.{apiUrl, projectId, environments}`    | kept                    | `local→dev`, `operations→ops`, `staging→staging`, the same mapping as Lombardi                                                                                                                                                                                                                                                                                                                |
| `domains.admin` `ekis-admin.bnq.pt`            | kept                    | the blueprint's CMS role                                                                                                                                                                                                                                                                                                                                                                      |
| `domains.frontend` `ekis.bnq.pt`               | kept                    | the blueprint's frontend role. Ekis calls it the storefront everywhere else (`STOREFRONT_DOMAIN`, `ekis-storefront`)                                                                                                                                                                                                                                                                          |
| `domains.docs` `ekis-docs.bnq.pt`              | kept                    | valid in v1 (`docs` is optional), but no generated file reads it                                                                                                                                                                                                                                                                                                                              |
| `credentials.{envFile, fields[29]}`            | **dropped**             | see below                                                                                                                                                                                                                                                                                                                                                                                     |
| `ploi.serverId`, `ploi.siteId`                 | kept, as `""`           | Ekis keeps them in `.env` and GitHub variables (`PLOI_SERVER_ID`, `PLOI_SITE_ID`), not the manifest. v1 also wants `systemUser`, `projectRoot`, `webDirectory`, `database`, `envTemplate` and `deployScript` (Lombardi sets all eight), and `gq ploi provision` requires `serverId`, `systemUser`, `webDirectory` and `deployScript` ([src/ploi/provision.mjs](../../src/ploi/provision.mjs)) |
| `cloudflare.{accountId, zoneId: "", zoneName}` | kept                    | `zoneId` stays empty                                                                                                                                                                                                                                                                                                                                                                          |
| `github.repository`                            | kept                    |                                                                                                                                                                                                                                                                                                                                                                                               |
| `github.environment` `"production"`            | **dropped**             |                                                                                                                                                                                                                                                                                                                                                                                               |
| `github.secrets` (5 names)                     | **dropped**             | `CLOUDFLARE_API_TOKEN`, `PLOI_API_TOKEN`, `GETQUICK_AUTH_COOKIE_SECRET`, `GETQUICK_STOREFRONT_PROXY_SECRET`, `TURNSTILE_SECRET`                                                                                                                                                                                                                                                               |
| `github.variables` (22 names)                  | **dropped**             | Ploi/Cloudflare IDs, the three domains, and the storefront's public `VITE_*`/`PUBLIC_*`/auth settings                                                                                                                                                                                                                                                                                         |
| `shop-devtools.config.mjs` `jsonFiles` (5)     | `release.jsonFiles` (5) | commerce has no defaults, so all five are additions                                                                                                                                                                                                                                                                                                                                           |
| … `releasePaths` (44)                          | `release.paths` (43)    | `shop-devtools.config.mjs` itself is dropped. The rest are kept verbatim, **including paths adoption would retire**: `packages/shop-devtools`, `scripts/release/version.mjs`, `scripts/ploi/*`, `deploy/ploi/admin.sh`. `AGENTS.md`, a content default, is not added                                                                                                                          |
| … `checks` (9)                                 | `verify.checks` (9)     | kept verbatim. The three `composer` checks lack the `requires: ["php"]` the content defaults carry, so `gq verify` won't skip them where PHP is missing                                                                                                                                                                                                                                       |
| … `textFiles: []`, `composer: null`            | gone                    | empty, so accepted                                                                                                                                                                                                                                                                                                                                                                            |
| … `versionFile`, `changelogPath`               | gone                    | equal to the fixed `VERSION`/`CHANGELOG.md`                                                                                                                                                                                                                                                                                                                                                   |
| … `releaseBranch: "main"`                      | **dropped** (warning)   |                                                                                                                                                                                                                                                                                                                                                                                               |
| … `docsChangelogPath`                          | **refused**             | `apps/docs/src/content/docs/changelog.mdx`. Ekis's release writes a docs changelog page                                                                                                                                                                                                                                                                                                       |
| … `deploys`                                    | **refused**             | `pnpm deploy:frontend`, `pnpm deploy:docs`                                                                                                                                                                                                                                                                                                                                                    |

### What v1 can't express

- **The 29 `credentials` fields.** Some are secrets (and now come only from Sigillo). The others are
  public configuration with defaults that have no v1 home: `VITE_DEFAULT_LOCALE` (`en-US`),
  `VITE_WOOCOMMERCE_API_URL`, `VITE_GETQUICK_CONFIG_API_URL`, `VITE_GETQUICK_DESIGN_API_URL`,
  `VITE_WORDPRESS_API_URL`, `GETQUICK_AUTH_UPSTREAM_URL`, `POST_DEPLOY_AUTH_AVAILABILITY`,
  `TURNSTILE_EXPECTED_HOSTNAMES`, `GETQUICK_ENVIRONMENT`, `ALCHEMY_PRODUCTION_ADOPTED`. Ekis's
  `infra/frontend.run.ts` reads them all from the environment. In v1 only the hostnames are derivable,
  from `domains`.
- **GitHub environment, secrets and variables.** These are dropped by design: gq no longer syncs
  GitHub Actions. Ekis's README says it doesn't use GitHub Actions either, so this loses a list, not
  a working flow.
- **A docs app.** `domains.docs` validates, but nothing generates or deploys docs. There is no
  `docsChangelogPath`, and the `deploys` list (frontend and docs) has no equivalent; releases deploy
  from the generated CI Worker.
- **The WordPress locale (`pt_PT`)**, the Composer reinstall list, and the `MEDIA_ENV_ONLY` mode have
  no manifest keys. See section 3.
- **Ekis's CI Worker settings.** `ci` has `worker`, `backupBucket` and `directory` only. There's no R2
  jurisdiction (Ekis's `ekis-ci-cache` is `eu`, with an EU endpoint), no second "drill" Workflow, and
  no revision-verification Durable Object or GitHub App. `ci.directory` only redirects `gq ci deploy`
  ([src/ci/deploy.mjs](../../src/ci/deploy.mjs)). `gq sync` still generates into `infra/ci`, because
  `blueprint/ownership.json` lists those paths literally.
- **Plugin activation that tolerates a missing plugin.** `wordpress.plugins` entries must be installed
  (`require_installed`). Ekis activates `s3-uploads` only if it is installed.

## 2. Managed files and sections that conflict with Ekis's own

Full `gq sync --check` after the manifest was migrated: 905 lines, exit 1. Paths are bucketed below.
"Edited" means the file exists, differs from the rendered template, and there's no `gq.lock.json` to
prove gq wrote it ([src/sync/managed-files.mjs](../../src/sync/managed-files.mjs)
`planGeneratedFile`). Any one edited path stops the whole sync.

| Status                           | Paths                                                                                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **edited, so sync refuses** (10) | `.vite-hooks/pre-commit`, `deploy/ploi/admin.sh`, `docs/agents/domain.md`, `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `infra/frontend.run.ts`, `infra/package.json`, `infra/scripts/deploy-frontend.mjs`, `package.json` (19 managed keys), `vite.config.ts` |
| section appended (2)             | `.gitignore`, `AGENTS.md`: neither has a `BEGIN gq` block, so one is appended                                                                                                                                                                                                     |
| created (22 + lock)              | `.claude/skills` (symlink), `.mise.toml`, `.nvmrc`, `.vite-hooks/pre-push`, `GLOSSARY.md`, `deploy/ploi/admin.d/README.md`, `docs/{adr,agents,plans,research}/README.md`, `infra/ci/*` (9 files), `scripts/ci-release.mjs`, `scripts/ci.test.mjs`, `gq.lock.json`                 |
| unchanged                        | `infra/tsconfig.json` (identical); every create-once file that already exists (`README.md`, `VERSION`, `pnpm-workspace.yaml`, the whole `apps/cms` and `apps/frontend` skeletons, because both apps exist)                                                                        |

To measure what a forced adoption writes, the 9 edited files were deleted and the 19 keys removed in
the throwaway, following the [adoption checklist](../plans/getquick-blueprint-rollout.md#adoption-checklist)
step 3. `gq sync` then wrote everything (exit 0). The tree changed in 12 modified files
(+348/−411) and 23 new paths. A second `gq sync --check` printed `Managed files: up to date.` (exit 0).

### `deploy/ploi/admin.sh`

The whole script is replaced, a 375-line diff. Section 3 covers what is lost.

### CI Worker: `apps/cloudflare-ci` vs the generated `infra/ci`

The two don't collide on paths. Sync creates `infra/ci/` and leaves `apps/cloudflare-ci/` alone, so
adoption would give Ekis **two** CI Workers:

|           | Ekis `apps/cloudflare-ci` (`ekis-ci`)                                                                                                          | generated `infra/ci`                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Names     | worker/workflow `ekis-ci`, artifacts `ekis-ci/ekis`, R2 `ekis-ci-cache` (EU)                                                                   | `<ci.worker>`, `<artifacts.namespace>`, `<artifacts.repo>`, `<ci.backupBucket>`, all **unrendered placeholders**, since the manifest has no `ci`/`artifacts`  |
| Trigger   | Artifacts push. A GitHub App webhook gates which SHAs are mirrored (fork/draft approval) and reports the `EKIS CI` check from a Durable Object | Artifacts push. The GitHub webhook and a `Mirror` Workflow mirror the repo; a commit status is posted                                                         |
| Pipeline  | one `portable-ci` step: install, build three packages, `pnpm ci:check` (5 retries)                                                             | `install` (pnpm plus composer, needs `COMPOSER_AUTH`), then `pnpm verify --ci`, then on `v*` tags `node scripts/ci-release.mjs` (`gq ploi release` + Alchemy) |
| Deploys   | **never**: its README says releases stay explicit local commands                                                                               | deploys CMS and frontend on tags                                                                                                                              |
| Container | `standard-4`, max 5                                                                                                                            | 1 vCPU / 4 GiB, max 6                                                                                                                                         |
| Extras    | `CIDrill` workflow, `wrangler.drill.jsonc`, revision-verification module with tests, Hono `/health`, `/revisions/:sha`                         | none                                                                                                                                                          |

Because the generated root `ci:check` becomes `pnpm --dir infra/ci run check`, Ekis's **existing**
Worker would run that command, which is only `tsc` over `infra/ci`, instead of the five-part suite.
`infra/ci` is also not a workspace package: Ekis's `pnpm-workspace.yaml` lists `apps/*`, `infra` and
four packages, and as a create-once file it is never updated.

### Frontend deploy: `infra/frontend.run.ts`, `infra/package.json`, `infra/scripts/deploy-frontend.mjs`

`infra/frontend.run.ts` (−150/+44): the storefront stack is replaced by the content site's Astro stack.

```diff
-export const Storefront = Cloudflare.Website.Vite("EkisStorefront", {
-  name: "ekis-storefront",
-  rootDir: "../apps/frontend",
-  domain: storefrontUrl.hostname,
   …
-  env: {
-    VITE_WOOCOMMERCE_API_URL: Config.String("VITE_WOOCOMMERCE_API_URL"),
     … 7 more VITE_*, GETQUICK_AUTH_UPSTREAM_URL, GETQUICK_ENVIRONMENT, GETQUICK_RELEASE,
-    GETQUICK_STOREFRONT_PROXY_SECRET: Config.Redacted("GETQUICK_STOREFRONT_PROXY_SECRET"),
-    GETQUICK_AUTH_COOKIE_SECRET: Config.Redacted("GETQUICK_AUTH_COOKIE_SECRET"),
-    TURNSTILE_EXPECTED_HOSTNAMES: …, TURNSTILE_SECRET: … (required when auth is available),
-    AUTH_IDENTIFIER_RATE_LIMITER / AUTH_IP_RATE_LIMITER / AUTH_PENALTY_RATE_LIMITER: Cloudflare.RateLimit(…),
-  },
   (plus observability settings and origin validation of VITE_STOREFRONT_URL / PUBLIC_STOREFRONT_URL)
+export const Website = Cloudflare.Website.Astro(
+  "EkisFrontend",
+  Stack.useSync(({ stage }) => {
+    const production = stage === "prod";
+    return {
+      name: production ? "ekis-fe" : `ekis-fe-${stage}`,
+      rootDir: "../apps/frontend",
+      ...(production ? { domain: productionHostname } : {}),   // gq.ops.json domains.frontend
+      astro: { site: …, output: "server" },
 …
 export default Alchemy.Stack(
-  "EkisStorefront",
+  "EkisFrontend",
```

`apps/frontend` is TanStack Start/React on Vite (`@tanstack/react-start`, `vp build`), not Astro. The
Worker name (`ekis-storefront` → `ekis-fe`) and the stack name both change. Alchemy would see these as
new resources, and the custom domain `ekis.bnq.pt` would be claimed by the new Worker. That last point
is reasoned from the names, not run.

`infra/package.json`:

```diff
-    "deploy:docs": "alchemy deploy --stage prod --config docs.run.ts --yes --no-input",
-    "deploy:docs:adopt": "alchemy deploy --stage prod --config docs.run.ts --adopt --yes --no-input",
-    "plan:docs": "alchemy deploy --stage prod --config docs.run.ts --dry-run --detailed --yes --no-input",
 …
-    "@alchemy.run/frontend-frameworks": "2.0.0-beta.78",
-    "@effect/platform-node": "4.0.0-rc.115",
-    "alchemy": "2.0.0-beta.78",
-    "effect": "4.0.0-rc.115",
-    "hono": "^4.13.8"
+    "@alchemy.run/frontend-frameworks": "catalog:",
+    "@effect/platform-node": "catalog:",
+    "alchemy": "catalog:",
+    "effect": "catalog:",
+    "hono": "4.12.14"
-    "@types/node": "22.20.1",
-    "typescript": "6.0.3"
+    "@types/node": "^24.0.0",
+    "typescript": "^6.0.3"
```

`infra/docs.run.ts` is site-owned and survives, but nothing runs it any more. Ekis's catalog has only
`vite`, `vitest` and `vite-plus`, so the four `catalog:` specs wouldn't resolve. That is reasoned from
pnpm's catalog rules; `pnpm install` wasn't run.

`infra/scripts/deploy-frontend.mjs` gains defaults read from `gq.ops.json`:
`CLOUDFLARE_ACCOUNT_ID ← cloudflare.accountId` and
`PUBLIC_WORDPRESS_GRAPHQL_URL ← https://<domains.admin>/wp/graphql`. Ekis's storefront reads
WooCommerce Store API and REST URLs, not GraphQL.

### Hooks and `vite.config.ts`

```diff
 .vite-hooks/pre-commit
 vp staged
-pnpm ci:check
-pnpm wordpress:check:local
+pnpm check
```

Ekis's root `package.json` has no `check` script, and the managed keys don't add one. The new
`.vite-hooks/pre-push` runs `pnpm verify`, which is `gq verify` over the nine folded checks.

`vite.config.ts` (fully generated) drops Ekis's whole `lint` block (type-aware oxlint, the
`vite-plus/prefer-vite-plus-imports` rule, test overrides) and its `fmt` block (`printWidth: 80`,
`sortPackageJson: false`, ignore patterns). It keeps a `staged` map that now also runs `vp lint` on
JS/TS. The root `fmt`/`fmt:check`/`ci:check:quality` scripts (`vp fmt`, `vp lint`) would then run with
the vite-plus defaults.

### `AGENTS.md` and `.gitignore`

- **`AGENTS.md`:** a 73-line section is appended after Ekis's own content. Ekis already has
  `## Agent skills` / `### Issue tracker` / `### Triage labels` / `### Domain docs`, and the section
  repeats all four. Its `## Safety` overlaps Ekis's `## Database safety (mandatory)`.
  - It says skills live in `.agents/skills/` with `.claude/skills` a symlink, and "don't recreate
    `.pi/skills`". Ekis tracks its skills in **`.pi/skills/`** (`skills-lock.json`) and has no
    `.agents/`, so the created `.claude/skills → ../.agents/skills` symlink dangles.
  - It names `pnpm db:sync` (`gq db sync`), which needs `backups` and `local.adminEmail`. Ekis's
    manifest has neither.
- **`.gitignore`:** a 34-line section is appended. Eleven of its rules duplicate Ekis's own lines
  (`.DS_Store`, `.env`, `.dev.vars`, `node_modules/`, `.vite-hooks/_/`, `.alchemy/`, `.pnpm-store/`,
  `dist/`, `.wrangler/`, `playwright-report/`, `test-results/`). Ekis's `.env.*` and `.vscode/` are
  broader than the section's.

### `docs/agents/*`

- **`domain.md`:** `CONTEXT.md`/`CONTEXT-MAP.md` become `GLOSSARY.md`. Ekis still has `CONTEXT.md`;
  `GLOSSARY.md` is created beside it from the template.
- **`triage-labels.md`:** two sentences are shortened.
- **`issue-tracker.md` loses detail.** Ekis's "Wayfinding operations" section defines the map, child
  sub-issues, native blocking dependencies, the frontier query, and the claim and resolve steps. The
  blueprint's version keeps one sentence (the map is an issue labelled `wayfinder:map`).

### `package.json` managed keys

Nineteen existing script keys differ, so the file counts as edited. Once they were removed, sync set
those 19 again and added 29 more, plus `engines.node` (`>=22.12.0`) and `packageManager`
(`pnpm@12.6.0`). Section 4 covers the effect on each script. Ekis's own keys (`build`, `test`,
`typecheck`, every `ploi:*`/`cloudflare:*`/`ci:check:*`, …) are untouched.

## 3. What Ekis's `admin.sh` does that the generated CMS deploy doesn't

Compared against Ekis's [`deploy/ploi/admin.sh`](https://github.com/Quick-Release/ekis/blob/ce258d8/deploy/ploi/admin.sh),
the generated [template](../../blueprint/templates/deploy/ploi/admin.sh), and the script rendered for
Ekis.

| Ekis `admin.sh`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Generated script for Ekis                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Git-based deploy.** `git fetch origin $BRANCH && git reset --hard origin/$BRANCH`, or a shallow `git clone` + `rsync --delete` on a site without `.git`. `BRANCH`/`REPOSITORY` default to `main` and `Quick-Release/ekis`. `pnpm ploi:deploy` passes `getquick_release_sha`                                                                                                                                                                                                                                         | Release-archive deploy. It exits 1 unless `ARCHIVE_URL` (from `gq ploi release`) is set, downloads and unpacks it, and `rsync --delete`s only `apps/cms` and `deploy/ploi` with the server's own paths protected. The SHA is read from `RELEASE`                                                                                                                                                        |
| **`GETQUICK_DEPLOY_STATUS=success\|failed … SHA=`** on exit (SHA from `git rev-parse HEAD`). Ekis's `scripts/ploi/ploi-deploy-status.mjs` and its tests parse this name                                                                                                                                                                                                                                                                                                                                               | **`EKIS_DEPLOY_STATUS=…`**: `deployStatusMarker(project)` upper-cases `gq.ops.json` `project` ([src/ploi/provision.mjs](../../src/ploi/provision.mjs))                                                                                                                                                                                                                                                  |
| **`pt_PT` locale** (`WP_LOCALE`). `wp core install --locale`, `wp language core install`, `wp option update WPLANG`, `wp language core update`, `wp language plugin install --all pt_PT`, `wp language plugin update --all`                                                                                                                                                                                                                                                                                           | none. No locale handling                                                                                                                                                                                                                                                                                                                                                                                |
| **First install.** `wp core install` with `WP_HOME`, `WP_SITE_TITLE` (default `Ekis Admin`), `WP_ADMIN_*`                                                                                                                                                                                                                                                                                                                                                                                                             | never installs. Install is via `/wp/wp-admin/install.php`, and every WordPress step is skipped until it is installed                                                                                                                                                                                                                                                                                    |
| **WooCommerce reinstall list** (`COMPOSER_ONLY=true`): `composer reinstall` of `roots/wordpress-no-content`, `humanmade/s3-uploads`, `wp-plugin/portugal-states-distritos-for-woocommerce`, `wp-plugin/simple-history`, `wp-plugin/woocommerce`, `wp-plugin/wp-graphql`, `wp-theme/twentytwentyfive`, `getquick/getquick-config`, `getquick/getquick-design`, `getquick/getquick-ecommerce`, `getquick/getquick-theme`, `getquick/gq-support`. Then it echoes the WordPress and WooCommerce versions and the web root | `COMPOSER_ONLY` runs `composer install`, then rsyncs shipped plugins and themes back. No reinstall                                                                                                                                                                                                                                                                                                      |
| **Legacy clean-ups.** (a) Moves the server's `apps/admin` into `apps/cms`, keeps `apps/admin.before-cms`, and symlinks `apps/admin → cms`. (b) `rm -rf web/app/plugins/getquick-options`. (c) `deactivate_plugins("getquick-options/getquick-design.php")`. (d) `GETQUICK_THEME_MIGRATION_MODE=apply wp eval-file scripts/getquick-theme-rename.php`                                                                                                                                                                  | none. The README says these belong in `deploy/ploi/admin.d/*.sh`                                                                                                                                                                                                                                                                                                                                        |
| **Theme activation.** `activate_theme_if_needed getquick-theme`, then asserts it's active                                                                                                                                                                                                                                                                                                                                                                                                                             | only `require_installed theme getquick-theme`. Activation would be a deploy extension, like Lombardi's `10-theme.sh`                                                                                                                                                                                                                                                                                    |
| **Plugin activation**, in order: `woocommerce`, `getquick-design`, `gq-support`, `getquick-ecommerce`, `ekis-blocks`, `wp-graphql`, `portugal-states-distritos-for-woocommerce`, `simple-history`, then `s3-uploads` only if installed                                                                                                                                                                                                                                                                                | `for plugin in ; do`: **none**, because `wordpress.plugins` is absent                                                                                                                                                                                                                                                                                                                                   |
| **`MEDIA_ENV_ONLY=true` mode.** Copies `.env`, checks `S3_UPLOADS_BUCKET_URL=https://ekis-media.bnq.pt`, and exits before WP-CLI or Composer                                                                                                                                                                                                                                                                                                                                                                          | none                                                                                                                                                                                                                                                                                                                                                                                                    |
| Sources the app `.env` into the shell (`set -a`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | only copies `.env` into `apps/cms`                                                                                                                                                                                                                                                                                                                                                                      |
| Downloads the WP-CLI phar into `~/.local/bin` if `wp` is missing                                                                                                                                                                                                                                                                                                                                                                                                                                                      | assumes `wp`                                                                                                                                                                                                                                                                                                                                                                                            |
| `wp cache flush`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | none                                                                                                                                                                                                                                                                                                                                                                                                    |
| `require_composer_auth`, with a message naming `pnpm ploi:deploy:sigillo`                                                                                                                                                                                                                                                                                                                                                                                                                                             | same check, naming `pnpm ploi:release`                                                                                                                                                                                                                                                                                                                                                                  |
| (none)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **New for Ekis:** `wp core update-db`; `run_deploy_extensions`; `mkdir -p web/app/uploads`; a post-Composer rsync of shipped plugins and themes. Also a **one-time `wp s3-uploads upload-directory`** of server uploads to the bucket, run when S3 Uploads is enabled and the `getquick_media_uploads_copied` option is absent. That option is absent on Ekis unless something set it; not checked live |

Both scripts share the PHP-FPM reload, the maintenance-mode trap, the `index.html`/`public` symlink
normalisation, the `getquick-config` mu-plugin check (generated: fatal; Ekis: a bare `wp eval` under
`set -e`), and `wp rewrite flush --hard`.

How the script reaches Ploi also differs. Ekis uploads `deploy/ploi/admin.sh` whole as the Ploi deploy
script (`pnpm ploi:update:deployscript`, `scripts/ploi/ploi-utils.mjs` `deployScriptPath`). gq syncs it
from `gq.ops.json` `ploi.deployScript` on each `gq ploi release`
([src/ploi/release.mjs](../../src/ploi/release.mjs)), and Ekis's manifest has no `ploi.deployScript`.
[ploi-atomic-deploys.md](https://github.com/Quick-Release/getquick-site/blob/research/ploi-atomic-deploys/docs/research/ploi-atomic-deploys.md)
records that Ekis's live site has a GitHub repository attached, where gq's sites use custom
deployments. Switching to the archive script therefore also implies a Ploi repository change.

## 4. Ekis root scripts after a forced sync

Ekis's root `package.json` has 76 scripts.

### Taken over by gq (managed keys)

The implementation changes to `gq`.

| Script                                                                               | Ekis today                                                                                                     | After sync                                                       | Effect                                                                                                                                |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ci:check`                                                                           | the five-part portable suite (quality, typecheck, packages, scripts, build)                                    | `pnpm --dir infra/ci run check`                                  | **The suite is lost.** Ekis's CI Worker and old pre-commit run `ci:check`; `ci:check:*` remain but are orphaned                       |
| `deploy:frontend`                                                                    | `pnpm --filter @ekis/frontend run deploy`, which builds the renderer, typechecks, then `infra deploy:frontend` | `gq sigillo run staging -- pnpm --dir infra run deploy:frontend` | goes through the generated Astro stack. The renderer build and typecheck are lost. `deploy:frontend:sigillo` now double-wraps Sigillo |
| `push`, `release`, `release:prepare`, `release:tag`, `version:check`, `version:sync` | `scripts/release/version.mjs`, i.e. the vendored `packages/shop-devtools`                                      | `gq release …` / `gq version …`                                  | `release` changes meaning: `release` = `gq release prepare`. The old code needs `shop-devtools.config.mjs`, which the fold deletes    |
| `cms:composer`, `cms:dev`, `cms:dev:raw`, `cms:stop`, `cms:lint`                     | `sigillo-run.mjs local -- composer …` / `cd apps/cms && ddev …`                                                | `gq sigillo run local -- gq cms …`                               | equivalent                                                                                                                            |
| `sigillo:login`, `sigillo:setup`, `sigillo:list:{local,ops,staging}`                 | `sigillo … --api-url … --project …`                                                                            | `gq sigillo …`                                                   | equivalent, through the manifest's `sigillo` block                                                                                    |
| `infra:check`                                                                        | `pnpm --dir infra check`                                                                                       | `pnpm --dir infra run check`                                     | equivalent (`tsc` of `infra`, now the Astro stack)                                                                                    |

### Added

Twenty-nine scripts are added. Some need manifest blocks Ekis lacks: `db:sync`/`db:backup` need
`backups` and `local`; `ploi:provision`/`ploi:release` need a full `ploi` and `releases`;
`cf:media`/`ploi:media` need `media`; `ci:deploy` and `cf:ci` need `ci` and `artifacts`.
`test:scripts` (`node --test scripts/*.test.mjs`) would also pick up Ekis's four root tests
(`customer-auth-health`, `db-sync`, `post-deploy`, `test-env-plan`).

### Lose their implementation

These scripts stay but point at something the sync removes or breaks:

- `infra:plan:docs`, `infra:deploy:docs`, `infra:adopt:docs`, `deploy:docs`, `deploy:docs:sigillo`:
  `infra`'s `plan:docs`/`deploy:docs`/`deploy:docs:adopt` scripts are gone (`apps/docs`'s `deploy`
  calls `infra deploy:docs`).
- `infra:plan:frontend`, `infra:deploy:frontend`, `infra:adopt:frontend`: these now plan or deploy the
  Astro stack.
- `ploi:deploy`, `ploi:deploy:sigillo`, `ploi:update:deployscript`: these trigger or upload a deploy
  script that now needs `ARCHIVE_URL` and prints `EKIS_DEPLOY_STATUS`.
- `ci:check:quality`, `ci:check:typecheck`, `ci:check:packages`, `ci:check:scripts`,
  `ci:check:build`: nothing calls them any more.
- `ci:cloudflare:build`, `ci:cloudflare:deploy`, `ci:cloudflare:push`: still target
  `apps/cloudflare-ci`, which keeps working on its own but now runs the shrunken `ci:check`.

### No `gq` equivalent

These stay site-owned:

- **Ploi:** `ploi:setup`, `ploi:sync-media-env`, `ploi:user:info`, `ploi:user:update`,
  `ploi:user:rollback`, `ploi:update:deployscript` (`gq ploi release` syncs the script only as part of
  a release). Also Ekis's Ploi backup scripts (`scripts/ploi/ploi-backup*.mjs`, which have no root
  script).
- **Cloudflare:** `cloudflare:ci:sync-tokens`, `cloudflare:token-manager:setup`, the setup wizards
  `setup-cloudflare-ci.sh` and `setup-revision-verification.sh`, and the GitHub App revision
  verification as a whole.
- **Storefront and auth:** `customer-auth:health`, `gq` (`scripts/gq.mjs`: `test post-deploy`),
  `frontend`, `frontend:dev`, `frontend:dev:raw`, `start`/`start:raw`/`stop` (`scripts/local/*`, DDEV
  plus the storefront dev server), `design:check`.
- **Docs:** `docs`, `dev:docs`, `deploy:docs*`, `infra:*:docs`.
- **WordPress:** `wordpress:check:local` (PHP, WordPress integration, DDEV and browser checks, formerly
  in pre-commit), `install:all`.
- **Workspace:** `build`, `test`, `typecheck`, `fmt`, `fmt:check`, `test:*` (6), `command`, `prepare`.

### Existing scripts with a partial `gq` counterpart

Each of these has a `gq` command that may cover it, but adoption doesn't rewire the script:

| Ekis script                             | Candidate `gq` command                                   |
| --------------------------------------- | -------------------------------------------------------- |
| `ploi`, `cms` (`scripts/ploi/ploi.mjs`) | `gq ploi api`                                            |
| `ploi:deploy:sigillo`                   | `gq ploi release` (`ploi:release`)                       |
| `db` (`db sync`)                        | `gq db sync` (`db:sync`)                                 |
| `cloudflare:r2-media:setup`             | `gq cloudflare media`                                    |
| `ci:cloudflare:deploy`                  | `gq ci deploy` with `ci.directory: "apps/cloudflare-ci"` |

## Open questions surfaced

These are candidate decisions for the map. None is decided here.

1. **What the commerce variant generates** ([#28](https://github.com/Quick-Release/getquick-site/issues/28)).
   Today `--variant commerce` changes only the release, verify and doctor defaults (none). Every
   generated file is the content site's: the Astro frontend stack, GraphQL defaults, an `infra` with
   no docs, and no storefront secrets or rate limiters. Should commerce opt out of these managed paths,
   or have templates of its own?
2. **One CI Worker or two.** Ekis's Worker never deploys and gates merges through revision
   verification. The blueprint's deploys on tags. `ownership.json` hardcodes `infra/ci`, while
   `ci.directory` only steers `gq ci deploy`.
3. **The `release-config` fold refuses `docsChangelogPath` and `deploys`.** Ekis has to drop its docs
   changelog page and its deploy list, or gq has to gain a docs app.
4. **Public frontend configuration with no v1 home.** These are the dropped `credentials` defaults
   (locale, API URLs, auth availability, Turnstile hostnames).
5. **The deploy-status marker name.** It is `GETQUICK_DEPLOY_STATUS` in Ekis and
   `<PROJECT>_DEPLOY_STATUS` in gq.
6. **The `pt_PT` locale and translations**, and first-install via WP-CLI: manifest keys or a deploy
   extension?
7. **Legacy clean-ups** (the `apps/admin` move, `getquick-options`, the theme rename): check
   read-only whether they have already run on the server, as the checklist's step 2 asks, before they
   are dropped. Feeds [#30](https://github.com/Quick-Release/getquick-site/issues/30).
8. **The managed `docs/agents/issue-tracker.md` is less complete than Ekis's**, losing the wayfinding
   operations. Upstream Ekis's version into the blueprint?
9. **Skills directory.** Ekis uses `.pi/skills` and the blueprint mandates `.agents/skills`.
10. **The pre-commit hook needs a root `check` script**, which Ekis doesn't have and the managed keys
    don't add.
