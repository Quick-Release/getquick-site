# Changelog

All notable changes to `@getquick/site` are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); each release is tagged `v<version>`.

## 0.6.0 — 2026-10-01

### Added

- Lombardi's Cloudflare provisioning as `gq cloudflare deploy-token`,
  `releases`, `media` and `ci` (each `[--dry-run]`;
  `scripts/cloudflare-deploy-token.mjs`, `cloudflare-releases.mjs`,
  `cloudflare-media.mjs` and `cloudflare-ci.mjs`), with their account-scoped
  Cloudflare and Artifacts clients. Token names derive from `gq.ops.json`
  `project`; account, zone, buckets, domain and Artifacts repository come
  from `cloudflare`, `releases`, `media`, `artifacts` and `ci`. What they mint
  goes to the `staging` Sigillo environment over stdin.
- Lombardi's CI Worker commands as `gq ci deploy` and `gq ci runs`
  (`scripts/ci-deploy.mjs`), `gq github setup [--dry-run]`
  (`scripts/github-setup.mjs`) and `gq git artifacts setup|get|store|erase`
  (`scripts/git-artifacts.mjs`). The Worker lives in the new
  `gq.ops.json` `ci.directory` (default `infra/ci`); the GitHub repository is
  `github.repository`. The credential helper `setup` registers is the site's
  own `gq` under `gq sigillo run staging`, so existing clones re-run
  `git artifacts setup`.
- `run()` takes `stdin`, the readable stream `git artifacts get` reads git's
  credential request from; `bin/gq.mjs` passes `process.stdin`.
- `artifactsRemoteUrl({ accountId, namespace, repo })`, the Artifacts git
  remote, for a site's health check.

## 0.5.0 — 2026-10-01

### Added

- Lombardi's database sync as `gq db sync [--yes]` (`scripts/db-sync.mjs`
  with `db-sync-run.mjs`'s relaunch under mkcert's CA) and `gq db backup`
  (`db-sync.mjs --backup-only`). It stays live → local only, and the
  export-only guard still refuses, before Ploi receives it, any server script
  that could write to a database. Site values come from `gq.ops.json`
  `backups`, `domains`, `ploi` and `cloudflare`, plus the new `local`:
  `local.adminEmail` (required by `sync`) is the local `dev` administrator's
  address, and `local.frontendUrl` (default `http://localhost:4321`) the
  local frontend the live one is replaced with.
- The modules `db sync` needs from Lombardi's local CMS tooling, as is: the
  local Design source override (`scripts/lib/cms-local-design.mjs`, with an
  async `withDesignRegistryInstall` and `runDesignCommand` through `exec`),
  the host Composer install around it (`cms-composer.mjs`'s
  `composerInstall`), DDEV status and `apps/cms/.env` wiring
  (`scripts/lib/ddev.mjs`, `cms-env.mjs`; `S3_UPLOADS_BUCKET_URL` defaults
  from `media.domain`). They have no commands of their own yet, and the
  override's generated DDEV hooks still run Lombardi's
  `scripts/cms-local-design.mjs` until its DDEV startup moves into `gq`.

### Changed

- The export marker is named after `gq.ops.json` `project`:
  `<PROJECT>_DB_EXPORT`, so Lombardi's `LOMBARDI_DB_EXPORT` is unchanged.

## 0.4.0 — 2026-10-01

### Added

- Lombardi's Ploi workflows as `gq ploi provision [--dry-run | --yes]`
  (`scripts/ploi-provision.mjs`), `gq ploi release [--ref <ref>]
[--git-dir <dir>]` (`scripts/ploi-release.mjs`) and `gq ploi media
[--dry-run]` (`scripts/cloudflare-media.mjs --ploi-env`), with their
  server-scoped Ploi client, R2 client and `.env` editing. Site values come
  from `gq.ops.json` `ploi`, `domains`, `releases`, `media` and `cloudflare`;
  a missing key is a configuration error naming it. `release` still syncs
  Ploi's stored deploy script from the release commit before every deploy and
  hands `COMPOSER_AUTH` over as the `composer_auth` deploy variable, failing
  before any upload when it is missing.
- `run()` takes `lookup` (node:dns/promises' signature) for the DNS check
  behind `ploi provision`'s certificate step; `bin/gq.mjs` passes the real
  one.
- `ploiReleaseShippedPaths`, the paths a release archive ships, for a site's
  test of its deploy script.

### Changed

- The deploy status line `ploi release` waits for is named after
  `gq.ops.json` `project`: `<PROJECT>_DEPLOY_STATUS` (upper-cased, other
  characters as `_`), so Lombardi's `LOMBARDI_DEPLOY_STATUS` is unchanged.
- Outside a terminal the workflows print plain progress lines instead of
  Clack's spinners; the plan and results are the same.
- Hints name `gq` commands rather than Lombardi's `pnpm` scripts.

## 0.3.0 — 2026-10-01

### Added

- The Sigillo wrapper (Lombardi's `scripts/sigillo/sigillo-run.mjs` and
  `sigillo-cli.mjs`) as `gq sigillo`: `run <environment> -- <command>`,
  `login`, `setup <environment>` and `secrets <environment> [arguments...]`.
  The project, API URL and environments come from `gq.ops.json` `sigillo`; a
  missing or placeholder value is a configuration error. The argv-safe form,
  per-command injection, bootstrap scrubbing and re-entry guard carry over;
  the guard variable is now the site-neutral `GQ_SIGILLO_REENTRY`. `setup`
  and `secrets` refuse `download` and `--mount` (also as `--mount=<path>`).
- `exec` accepts `stdio: "inherit"` for children that need the terminal; a
  child killed by a signal then exits 128 + the signal number.

### Changed

- `run()` resolves to a wrapped command's own exit code.

### Not carried over

- The wrapper's Windows `sigillo.cmd`/`npx.cmd` lookup, which could not run:
  `exec` spawns without a shell, and Node refuses `.cmd` files then.

## 0.2.0 — 2026-10-01

### Added

- The release and version commands of the vendored `shop-devtools`
  (Lombardi's copy) under `gq`, still reading the site's
  `shop-devtools.config.mjs`: `gq version check|sync [version]`,
  `gq release prepare [version]`, `gq release tag [version]`, and
  `gq release push <major|minor|fix> [--no-deploy]`. They replace
  `shop-devtools check|sync`, `prepare`/`release`, `tag` and `push`. Every git,
  check and deploy command runs through `run()`'s `exec`.
- `exec` forwards a child's output to `stdout`/`stderr` streams passed in its
  options as it arrives, so a release's checks and pushes stream as before.

### Changed

- `release prepare` covers both `shop-devtools prepare` and
  `shop-devtools release`, which differed only in the closing hint; it always
  prints it, naming `gq release tag`.
- File paths in the release config resolve from the site root (the directory
  with `gq.ops.json`), not the current directory.

### Fixed

- `release push` leaves a blank line between the new changelog entry and the
  previous one.

### Not carried over

- `docsChangelogPath` (the Starlight docs changelog page) and the legacy
  `wrangler` deploys, which Lombardi no longer used. A release config that
  still sets `docsChangelogPath` is an error rather than silently ignored.

## 0.1.1 — 2026-10-01

### Fixed

- The README describes the published package: install, configuration,
  commands, `run()`, and releasing.
- `exec` no longer crashes the process when a child exits without reading
  its input, and decodes output as UTF-8 so multibyte characters survive
  chunk boundaries.
- `run()` rejects a call without `stdout` and `stderr` up front instead of
  failing while reporting another error.
- `release:publish` stops with a clear message when a `git` check fails,
  instead of reading a failed `git status` as a clean tree.

## 0.1.0 — 2026-09-30

First release: `gq-ops` 0.1.0 (`Quick-Release/gq-ops@d972d12`) as the `gq` bin
of `@getquick/site`.

### Added

- `run(argv, { cwd, env, fetch, exec, stdout, stderr })`, the in-process entry
  point behind `gq`. It resolves to the exit code; commands read no
  `process.env` or `process.cwd()`, and every provider request and child
  process goes through the injected `fetch` and `exec`.
- A fixture-site test harness (`test/support/fixture-site.mjs`): a temporary
  Git repository with a `gq.ops.json`, and recording `fetch` and `exec` fakes.
- `pnpm release:publish`, which publishes a tagged version with `NPM_TOKEN`
  from Sigillo.

### Carried over from gq-ops, unchanged

- `gq context show`, `gq ploi …` (including all 225 `ploi api` operations),
  `gq cloudflare …`, and `gq github actions sync`, with the same forms, output,
  and `gq.ops.json` discovery.

### Changed

- Without `XDG_CONFIG_HOME` or `HOME` in `env`, no machine `gq/ops.env` is read.
- Ploi requests identify as `getquick-site/<version>` instead of
  `gq-ops/<version>`.

### Removed

- `gq credentials configure`, which wrote provider tokens to `.env`; sites
  inject them per command from Sigillo instead.
- `gq test post-deploy`, which only ran a site's own `pnpm gq test post-deploy`
  script.
