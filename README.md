# getquick-site

Shared tooling for GETQUICK sites, published to public npm as
[`@getquick/site`](https://www.npmjs.com/package/@getquick/site): one `gq`
CLI, configured by each site's own `gq.ops.json`.

It replaces [`gq-ops`](https://github.com/Quick-Release/gq-ops) and the
vendored `shop-devtools`. The package is being extracted from the Lombardi
site (phase 1 of the [GETQUICK blueprint rollout](docs/plans/getquick-blueprint-rollout.md),
whose design is [ADR 0001](docs/adr/0001-the-getquick-site-blueprint.md)); release and version sync,
Ploi provisioning and releases, database sync and backups, Cloudflare CI and
media, Sigillo secret injection, and the `setup`/`doctor`/`verify` runners
move in over the coming releases. Today it carries `gq-ops`'s commands (Ploi,
Cloudflare, and GitHub Actions sync), `shop-devtools`'s release and version
commands, the Sigillo wrapper, and Ploi provisioning, releases and media
settings.

## Install

Pin an exact version in the site's root `devDependencies`; it needs no
registry login:

```sh
pnpm add --save-dev --save-exact @getquick/site
```

```json
{
  "scripts": {
    "ops": "gq"
  }
}
```

## Configure a site

`gq` walks up from the current directory to the nearest `gq.ops.json`,
stopping at the enclosing Git repository, and treats that directory as the
site root. Every site-relative path resolves from there. `--project <dir>` or
`--config <file>` selects a site explicitly.

```json
{
  "$schema": "./node_modules/@getquick/site/schema/gq.ops.schema.json",
  "schemaVersion": 1,
  "project": "example-site",
  "variant": "content",
  "domains": { "admin": "example-site-cms.bnq.pt", "frontend": "example-site-fe.bnq.pt" },
  "ploi": { "serverId": "12345", "siteId": "67890" },
  "cloudflare": {
    "accountId": "0123456789abcdef0123456789abcdef",
    "zoneId": "abcdef0123456789abcdef0123456789",
    "zoneName": "example.com"
  },
  "github": { "repository": "Quick-Release/example-site" }
}
```

`gq.ops.json` is validated against schema v1 before any command runs
([ADR 0002](docs/adr/0002-generate-sites-from-a-versioned-manifest.md)):
`schemaVersion`, `project` and `variant` (`content` or `commerce`) are
required, `domains` has the roles `admin` and `frontend` and an optional
`docs`, and an unknown or misspelt key fails by its path. The blocks each
command reads (`ploi`, `cloudflare`, `releases`, `media`, `backups`, `local`,
`artifacts`, `ci`, `github`, `sigillo`, `wordpress.plugins`) are optional;
a command names the keys it needs. `$schema` points editors at the JSON
Schema generated from it ([schema/gq.ops.schema.json](schema/gq.ops.schema.json)).

A manifest without `schemaVersion` is v0, the shape before versioning. Every
command refuses it, and one newer than the installed `gq` reads, with the
step to take. `gq sync` migrates it:

```sh
gq sync --manifest --variant content   # v0 → v1, written back
gq sync --manifest --check             # report pending migrations, exit 1, write nothing
```

v0 never recorded the variant, so the v0 → v1 migration takes it from
`--variant` rather than guessing. It drops the keys of flows `gq` no longer
has (`credentials`, `github.environment`, `github.secrets`,
`github.variables`) and names each one. `gq sync` needs no network access
and no secrets.

Provider IDs are safe to commit; tokens are not. `gq` reads `PLOI_API_TOKEN`,
`CLOUDFLARE_API_TOKEN` and optional ID overrides (`PLOI_SERVER_ID`,
`PLOI_SITE_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`,
`CLOUDFLARE_ZONE_NAME`) from, in increasing precedence:

1. `${XDG_CONFIG_HOME:-$HOME/.config}/gq/ops.env`
2. the site's `.env`
3. the process environment, which is where a secret manager such as Sigillo
   injects them per command
4. flags (`--server`, `--site`, `--account`, `--zone`)

## Generate and sync a site

`gq new` creates a site from the blueprint; `gq sync` keeps it in step with
the installed `gq` ([ADR 0002](docs/adr/0002-generate-sites-from-a-versioned-manifest.md)):

```sh
gq new acme --project acme --variant content   # gq.ops.json, managed files, gq.lock.json, git init
gq sync           # migrate gq.ops.json, regenerate managed files, update gq.lock.json
gq sync --check   # report every pending change, exit 1, write nothing
gq sync --recreate README.md   # write a create-once file again
```

[`blueprint/ownership.json`](blueprint/ownership.json), published with the
package, lists every path the blueprint touches by category: fully
generated, generated section, managed keys, and create-once. Anything it
doesn't list is site-owned, and `gq sync` never reads or writes it. The
fully generated files so far are the ones that need no site values,
extracted from Lombardi: the toolchain pins (`.mise.toml`, `.nvmrc`), the
Git hooks (`.vite-hooks/pre-commit` formats and lints staged files,
`pre-push` runs `pnpm verify`), the staged lint/format config
(`vite.config.ts`), the READMEs of `docs/adr`, `docs/plans`, `docs/research`
and `docs/agents`, the agent reference docs in `docs/agents`, and the
`.claude/skills` symlink to `../.agents/skills`. A site's own ADRs, plans
and research beside those READMEs are site-owned. Only `--variant content`
is generated until phase 4.

A site shares three more kinds of file with the blueprint:

- **Generated sections.** `AGENTS.md` holds the blueprint's base guidance
  and `.gitignore` its ignore rules, each between a `BEGIN gq` line and an
  `END gq` line. `gq sync` rewrites only what is between them; the site's
  guidance and rules go outside, before or after. A file without the
  section gets it appended; markers it can't pair (one missing, or two
  sections) stop sync with an error.
- **Managed keys.** In the root `package.json`, `gq` sets the
  `packageManager` and `engines.node` pins, the hook install (`prepare`),
  and the root scripts that wrap `gq` (`verify`, `cms:*`, `ploi:*`,
  `release*` and the rest). Every other key, including the site's own
  scripts and its dependencies, is the site's: `gq` edits the file as text,
  so those keys stay byte for byte. A managed key the site removed is added
  back after its siblings, in the file's indentation. One the blueprint
  retires is removed, unless the site changed it, in which case it is the
  site's.
- **Create-once files.** `gq.ops.json`, the glossary (`CONTEXT.md`) and
  `README.md` are written when absent, and recorded in the lock as created
  once they exist, whoever wrote them.
  From then on they are the site's: `gq sync` never rewrites them, nor
  restores one the site deleted, unless `gq sync --recreate <path>` asks
  for it (repeat it for several files; `gq.ops.json` can't be recreated).

`gq.lock.json`, committed at the site root, records the `gq` version, the
schema version, a hash of each managed file (a symlink's target), section
and key as `gq` last wrote it, and the create-once files it has created. A
managed file, section or key whose hash differs from the lock (or that
differs from the template when the site has no lock yet), a retargeted
symlink, or a directory where either belongs is a local edit: `gq sync`
prints a diff against what it would write and writes nothing, not even a
pending migration. A managed file that lost its executable bit (a hook) is
not an edit: `gq sync` makes it executable again. Revert the edit, or delete
the file (the section, or the key) and `gq sync` regenerates it.
A lock written by a newer `gq` is refused rather than downgraded. Neither
command needs network access or secrets.

## Commands

```sh
gq --version
gq context show [--json]
gq new <dir> --project <name> --variant content
gq sync [--manifest] [--check] [--variant <content|commerce>] [--recreate <path>]...

gq setup [--no-ddev]
gq doctor
gq verify [--ci]

gq ploi servers list
gq ploi server show [--server <id>]
gq ploi sites list [--server <id>]
gq ploi site show [--server <id>] [--site <id>]
gq ploi api list [--group <group>] [--search <text>]
gq ploi api describe <operation-id>
gq ploi api <operation-id> [--path name=value] [--query name=value]
    [--page <n>] [--per-page <n>] [--data <json> | --data-file <file>]
    [--all] [--max-pages <n>] [--dry-run | --yes]
gq ploi provision [--dry-run | --yes]
gq ploi release [--ref <ref>] [--git-dir <dir>]
gq ploi media [--dry-run]

gq db sync [--yes]
gq db backup

gq cms start [--foreground] [ddev start arguments...]
gq cms status
gq cms stop | describe [ddev arguments...]
gq cms composer install | update | reinstall | test | lint | lint:fix [arguments...]
gq cms design [refresh]

gq cloudflare accounts list
gq cloudflare zones list [--account <id>]
gq cloudflare zone show [--zone <id>]
gq cloudflare dns list [--zone <id>] [--name <hostname>] [--type <type>]
gq cloudflare deploy-token [--dry-run]
gq cloudflare releases [--dry-run]
gq cloudflare media [--dry-run]
gq cloudflare ci [--dry-run]

gq ci deploy
gq ci runs
gq github setup [--dry-run]
gq git artifacts setup
gq git artifacts get | store | erase

gq sigillo run <environment> -- <command> [arguments...]
gq sigillo login
gq sigillo setup <environment>
gq sigillo secrets <environment> [arguments...]

gq version check [version]
gq version sync [version]
gq release prepare [version]
gq release tag [version]
gq release push <major|minor|fix>
```

`--json` prints machine-readable output; `ploi api` always prints the
provider's JSON. In a terminal, `gq` with no arguments opens a command picker.

`ploi api` covers all 225 operations in the Ploi API reference
([inventory](docs/research/ploi-api.md)); operation IDs follow the docs' routes,
such as `sites.log-site`. Every non-GET operation needs `--yes` (or a prompt in
a terminal); `--dry-run` prints the resolved request without sending it.
The `cloudflare accounts|zones|zone|dns` commands are read-only.

## Sigillo secrets

`gq sigillo` runs the [Sigillo](https://www.npmjs.com/package/sigillo) CLI
against the project and environments in the site's `gq.ops.json`, so the
project ID lives in one place:

```json
{
  "sigillo": {
    "apiUrl": "https://secrets.example.com",
    "projectId": "01ABCDEFGHJKMNPQRSTVWXYZ00",
    "environments": { "local": "dev", "staging": "staging" }
  }
}
```

`environments` maps the names scripts use to Sigillo environments.
`gq sigillo run <environment> -- <command>` runs one command with that
environment's secrets: `sigillo run` starts `gq` again, which drops Sigillo's
own bootstrap variables (`SIGILLO_TOKEN`, `SIGILLO_API_URL`,
`SIGILLO_PROJECT`, `SIGILLO_ENVIRONMENT`) before running the command in the
site root. The inner step runs only when `SIGILLO=1` and the wrapper's guard
variable, `GQ_SIGILLO_REENTRY=1`, are both set. Everything after `--` is
passed on as-is, never through a shell.

Secrets are only ever injected per command: the wrapper never passes
`--mount`, and `setup`/`secrets` refuse `download` and `--mount`. `login` is
per checkout (`--scope .`). The site's installed `sigillo` bin is used, or
before the first install, the version the site pins in `devDependencies`, via
`npx`. Each of these commands hands the terminal to the child and exits with
its code.

```json
{
  "scripts": {
    "deploy": "gq sigillo run staging -- node ./scripts/deploy.mjs",
    "sigillo:login": "gq sigillo login"
  }
}
```

## Release and version commands

The release commands, `verify` and `doctor` read their settings from
`gq.ops.json`: the blueprint's defaults for the site's `variant`, plus the
additions the site declares. Additions are appended to the defaults; a site
can't remove one. Every path is relative to the site root.

The `content` defaults (Lombardi's settings):

- version file `VERSION` and changelog `CHANGELOG.md`, for every site;
- JSON files whose `version` follows `VERSION`: `package.json` and
  `apps/frontend/package.json`;
- release paths: `VERSION`, `CHANGELOG.md`, `README.md`, `package.json`,
  `pnpm-workspace.yaml`, `gq.ops.json`, `infra`, `deploy/ploi/admin.sh`,
  `AGENTS.md`, `apps/cms/.gitignore`, `apps/cms/composer.json`,
  `apps/cms/composer.lock` and `apps/frontend/package.json`;
- checks: `pnpm run check`, `lint`, `test`, `test:scripts`, `infra:check` and
  `ci:check`, then `composer --working-dir=apps/cms validate`, `run lint` and
  `run test` (each requiring `php`);
- required files: `apps/cms` `composer.json` and `.ddev/config.yaml`,
  `apps/frontend` `package.json` and `astro.config.mjs`.

`commerce` has no defaults until a commerce site adopts the blueprint, so a
commerce site declares everything as additions.

```json
{
  "release": {
    "jsonFiles": ["apps/docs/package.json"],
    "textFiles": [
      {
        "path": "apps/cms/web/app/themes/example-theme/style.css",
        "patterns": [
          { "regexp": "^Version: .+$", "flags": "m", "replacement": "Version: {version}" }
        ]
      }
    ],
    "paths": ["apps/cms/web/app/themes/example-theme/style.css"]
  },
  "verify": {
    "checks": [
      { "cmd": "pnpm", "args": ["run", "e2e"], "cwd": "apps/frontend", "requires": ["ddev"] }
    ]
  },
  "doctor": { "requiredFiles": { "apps/frontend": ["tsconfig.json"] } }
}
```

A text file's pattern is a regular expression (`regexp`, optional `flags`)
whose match is replaced by `replacement`, where `{version}` stands for the
version.

- `version check` fails, listing each file, when any of them doesn't carry
  `VERSION` or the given version.
- `version sync` writes `VERSION` (or the given version) into every file.
- `release prepare` also writes the version to the version file first.
- `release tag` checks the version and a clean tree, then creates an
  annotated `v<version>` tag.
- `release push` bumps the version (`fix` and `patch` bump the third number),
  syncs it, adds the commits since the last `v*` tag to the changelog, runs
  the checks, commits the release paths, tags, and pushes the branch and the
  tag. Command output streams through as it runs. Nothing deploys from here:
  Cloudflare CI deploys the pushed `v*` tag.

Sites used to keep these settings in `shop-devtools.config.mjs`.
`gq sync --manifest` folds that module into `gq.ops.json`, keeping only what
differs from the variant's defaults, and removes it. It names each default the
module left out (gq now adds it) and each check it moves after the defaults,
and refuses settings `gq.ops.json` can't express: another version file or
changelog, `composer`, `deploys` and `docsChangelogPath`. Until the module is
folded, the release commands and `verify` refuse to run, and `doctor` fails.

## Ploi provisioning and releases

These run through `gq sigillo run <environment> --`, which injects
`PLOI_API_TOKEN` and the other secrets they read. Site values come from
`gq.ops.json`:

```json
{
  "project": "example-site",
  "domains": { "admin": "admin.example.com", "frontend": "www.example.com" },
  "ploi": {
    "serverId": "12345",
    "siteId": "67890",
    "systemUser": "example",
    "projectRoot": "/",
    "webDirectory": "/apps/cms/web",
    "database": "example_staging",
    "envTemplate": "apps/cms/.env.production.example",
    "deployScript": "deploy/ploi/admin.sh"
  },
  "releases": { "bucket": "example-releases", "prefix": "admin/" },
  "media": { "bucket": "example-media", "domain": "media.example.com" },
  "cloudflare": { "accountId": "0123456789abcdef0123456789abcdef" }
}
```

- `ploi provision` inspects Ploi and plans, idempotently, the system user,
  the site, custom deployments (no git; releases come from R2), the database
  and the site `.env` (rendered from `ploi.envTemplate`), the deploy script
  and the Let's Encrypt certificate. `--dry-run` only reports the plan and
  the drift; applying asks first in a terminal and needs `--yes` elsewhere.
  It records a newly found site ID in `gq.ops.json`.
- `ploi release` packs the release commit (`--ref`, else the `v*` tag at
  `HEAD`, else `HEAD`) with `git archive`: `apps/cms` and `deploy/ploi` plus a
  `RELEASE` manifest. It uploads the archive to the `releases` bucket on R2
  (`RELEASES_R2_*`, else `R2_*` credentials), syncs Ploi's stored deploy
  script from `ploi.deployScript` as of that commit, and deploys with the
  deploy variables `archive_url` (a 30-minute presigned URL) and
  `composer_auth` (`COMPOSER_AUTH`, required). It fails unless the deploy log
  reports `<PROJECT>_DEPLOY_STATUS=success SHA=<the release commit>`.
  `--git-dir` reads the commit from another repository.
- `ploi media` sets the `S3_UPLOADS_*` lines of the Ploi site's `.env` for
  the `media` bucket from `S3_UPLOADS_KEY`/`S3_UPLOADS_SECRET`, leaving every
  other line as it is.

The site's deploy script is the other half of the contract: it reads
`$ARCHIVE_URL` and `$COMPOSER_AUTH`, deploys the paths in
`ploiReleaseShippedPaths` (exported for a site test), and prints the status
line.

## Database sync and backup

Live → local only: no `gq` command sends a database to the server. Both run
through `gq sigillo run <environment> --` for `PLOI_API_TOKEN`, the backup
bucket's `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` and, for `sync`,
`COMPOSER_AUTH`. Beside the `domains`, `ploi` and `cloudflare` values above,
they read:

```json
{
  "backups": { "bucket": "example-releases", "prefix": "db/" },
  "local": { "adminEmail": "dev@example.com", "frontendUrl": "http://localhost:4321" }
}
```

- `db backup` runs one Ploi script on the server: `wp db export`, gzipped
  and uploaded to `<backups.prefix><ploi.database>/<UTC time>.sql.gz` in the
  `backups` bucket through a 15-minute presigned URL, then
  `<PROJECT>_DB_EXPORT=success …` with its size and checksum. The script is
  refused, before Ploi gets it, if it could write to a database (`wp db
import`, `search-replace`, `wp user`, `mysql`, …).
- `db sync` first checks that `apps/cms/.env` targets the site's DDEV
  project (starting DDEV and wiring its database and URL into the `.env`),
  takes the backup, downloads and verifies it, runs `composer install` with
  the host Composer, snapshots the local database (`ddev snapshot`), imports
  the backup, replaces the live `domains` with the DDEV URL and
  `local.frontendUrl` (default `http://localhost:4321`), and resets the local
  administrator `dev` / `dev` with `local.adminEmail`. It confirms first in a
  terminal and needs `--yes` elsewhere. It relaunches itself with mkcert's
  public CA (`NODE_EXTRA_CA_CERTS`) so its last check can reach the local
  site over HTTPS.

## Workspace: setup, doctor and verify

The runners are shared; what they check is the site's.

- `setup` installs the workspace (`pnpm install --frozen-lockfile`), creates
  `apps/frontend/.env` and `apps/cms/.env` from their `.env.example` when
  missing, then starts DDEV and installs Composer through the site's
  `cms:dev:raw --foreground` and `cms:composer` scripts. `--no-ddev` stops
  after the `.env` files; without DDEV installed it stops there with a warning.
- `verify` runs the site's checks (the variant's defaults, then
  `verify.checks`; the list `release push` runs) in order, in the site root, on the terminal, stopping at the first failure
  with its exit code. A check is `{ cmd, args, cwd, env, requires }`;
  `requires` lists what it needs, `php` (Composer and
  `apps/cms/vendor`) or `ddev` (the project running), and defaults to `php`
  for a `composer` check. Locally a check whose requirement is missing is
  skipped and reported; `--ci` runs every check.
- `doctor` reports the running `@getquick/site` against the site's pin, Node
  against `package.json` `engines.node` and the `.mise.toml` (or `.nvmrc`)
  pin, pnpm against `packageManager`, git, the files each app must have
  (the variant's defaults plus `doctor.requiredFiles`,
  `{ "<app path>": ["<file>", …] }`),
  installed dependencies, a leftover Artifacts push URL (with
  `gq.ops.json` `artifacts`), the apps' `.env` files, Sigillo's project and
  login (with `sigillo`) and the DDEV project named in
  `apps/cms/.ddev/config.yaml`. A missing tool, required file or
  `node_modules`, or a Node below the minimum fails it (exit 1); drift from a
  pin only warns.

## Local CMS (DDEV)

The `cms` commands run the site's Bedrock app in `apps/cms` with DDEV. Like
`gq sigillo run`, they parse their own arguments: what `gq` doesn't use goes
to DDEV or Composer as is.

- `cms start` returns at once: a detached `gq` worker starts DDEV, then points
  `apps/cms/.env` at it (database, URL, and the defaults `db sync` uses). The
  worker records its phase in `apps/cms/.local-plugins/ddev-start.json` and
  its output in `ddev-start.log`; a second `start` while one runs reuses it.
  `--foreground` does the same work and waits, failing with DDEV's exit code.
- `cms status` reports the last background startup (ready, failed with its
  message, cancelled, or still starting) and the log's path, and exits 1 when
  it failed or its worker died. `cms stop` cancels a pending startup before
  stopping DDEV.
- `cms composer` runs Composer in a running DDEV project (its PHP matches the
  server), else with the host Composer, else in DDEV started for it. `install`,
  `update` and `reinstall` always use the host Composer with
  `COMPOSER_AUTH` from `gq sigillo run`, since the registry login doesn't
  reach DDEV's container.
- A developer can point `getquick-design` at a local checkout with an ignored
  `apps/cms/.local-plugins/config.json` (`{ "getquickDesign": "/absolute/path" }`):
  `cms start` symlinks it over the registry copy and writes local DDEV files
  that bind-mount it and run `gq cms design` (relink) and
  `gq cms design refresh` (autoload) as DDEV hooks, through the site's
  `node_modules/.bin/gq`. Composer dependency changes only ever see the
  registry copy, and CI never consults the override.

  Hook files generated by an older tool are rewritten by the next
  `gq cms start`; until then a plain `ddev start` runs the old hooks.

## Cloudflare provisioning and CI

The `gq cloudflare` provisioning commands run through `gq sigillo run
<environment> --` with the environment that holds the account's
`CLOUDFLARE_TOKEN_MANAGER_API_TOKEN`, and store what they mint in the
`staging` Sigillo environment (over stdin, never printed). Each finds its
token by name (`GETQUICK <PROJECT> …`), creates it when missing or inactive,
rolls it when Sigillo lost its value, and does nothing otherwise; `--dry-run`
only prints the plan. Buckets are created with a 1-hour token that is deleted
afterwards. Beside the `cloudflare`, `releases` and `media` values above, they
read:

```json
{
  "cloudflare": { "accountId": "…", "zoneId": "…", "zoneName": "example.com" },
  "artifacts": { "namespace": "example", "repo": "example" },
  "ci": { "worker": "example-ci", "backupBucket": "example-ci-backups", "directory": "infra/ci" },
  "github": { "repository": "example-org/example" }
}
```

- `cloudflare deploy-token`: "Staging Alchemy", the frontend's deploy token
  (account Workers permissions, plus Zone Read / DNS Write / Workers Routes
  Write on `cloudflare.zoneId` only) → `CLOUDFLARE_API_TOKEN`.
- `cloudflare releases`: the `releases` bucket and "Releases R2", object
  read/write on it only → `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (the S3
  keys R2 derives from the token), for `ploi release`.
- `cloudflare media`: the `media` bucket with its public custom domain, and
  "Media R2" → `S3_UPLOADS_KEY` / `S3_UPLOADS_SECRET`, for `ploi media`.
- `cloudflare ci`: "Artifacts" → `ARTIFACTS_API_TOKEN`, the `ci.backupBucket`
  bucket and "CI Backups R2" → `CI_BACKUP_R2_*`, "CI Deploy" →
  `CI_DEPLOY_API_TOKEN`, and the `artifacts` namespace and repository.

The site owns its CI Worker (in `ci.directory`, default `infra/ci`, with its
own Wrangler); these commands deploy and connect it:

- `ci deploy` deploys the Worker `ci.worker` with `CI_DEPLOY_API_TOKEN`, then
  sends its secrets to `wrangler secret bulk` as JSON over stdin: `CF_TOKEN`,
  `PLOI_API_TOKEN`, `COMPOSER_AUTH`, `GITHUB_CI_TOKEN`,
  `GITHUB_WEBHOOK_SECRET`, the backup bucket's key as `R2_*` and the releases
  bucket's as `RELEASES_R2_*`. It refuses, before Wrangler runs, when one is
  missing. `ci runs` lists the Worker's CI Workflow runs.
- `github setup` stores a generated `GITHUB_WEBHOOK_SECRET` and a pasted,
  validated fine-grained `GITHUB_CI_TOKEN` (prompting in a terminal only),
  then creates or updates `github.repository`'s push webhook to the Worker's
  `/github/webhook` through your `gh` login.
- `git artifacts setup` registers `gq git artifacts`, under
  `gq sigillo run staging`, as git's only credential helper for the Artifacts
  host, and drops the Artifacts push URL older setups added to `origin`. As
  the helper, `get` answers that host only with a read-only git token that
  expires in an hour; nothing is stored.

## Programmatic use

The CLI is a thin shell over `run()`, which resolves to an exit code:

```js
import { run } from "@getquick/site";

const code = await run(["ploi", "site", "show", "--json"], {
  cwd, // where discovery starts
  env, // replaces process.env
  fetch, // every provider request
  exec, // every child process: (command, args, { cwd, env, input, stdio, timeout, background, stdout, stderr }) => { code, stdout, stderr, pid? }
  lookup, // every DNS lookup, as node:dns/promises' lookup
  stdin, // a readable stream, for git's credential request
  stdout, // anything with write()
  stderr,
});
```

No command reads `process.env` or `process.cwd()`; `bin/gq.mjs` is the only
place that passes the real ones. `exec` is asked for `stdio: "inherit"` when a
child needs the terminal (`gq sigillo`, `gq cms`); it then captures nothing.
With `background: { log }` (`gq cms start`'s worker) it starts the child
detached in its own process group, writing its output to `log`, and resolves
with its `pid` once it has started.

## Development

```sh
pnpm install
pnpm check   # Prettier, ESLint, node:test
pnpm schema  # regenerate schema/gq.ops.schema.json after changing src/manifest/schema.mjs
```

Tests call `run()` against a fixture site (a temporary Git repository with a
`gq.ops.json`) with recording fakes for `fetch` and `exec`
([`test/support/fixture-site.mjs`](test/support/fixture-site.mjs)). They need
no network, credentials, or provider accounts.

## Releasing

1. Bump `version` in `package.json`, add its section to `CHANGELOG.md`, and
   commit.
2. Tag the commit `v<version>` and push the commit and tag.
3. `pnpm release:publish` checks that `HEAD` carries that tag and that
   `pnpm check` passes, then runs `npm publish` under Sigillo's `operations`
   environment (`gq.ops.json`), where `NPM_TOKEN` lives. The token is never
   written to disk. It is a granular token that expires within 90 days, so
   rotate it before then.

## License

[MIT](LICENSE)
