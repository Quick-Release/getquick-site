# gq-site

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
gq new acme --project acme --variant content   # a complete content site, gq.lock.json, git init
gq sync           # migrate gq.ops.json, regenerate managed files, update gq.lock.json
gq sync --check   # report every pending change, exit 1, write nothing
gq sync --recreate README.md   # write a create-once file again
```

`gq new` writes everything a content site needs to pass `pnpm verify`
without network access or secrets: a v1 `gq.ops.json` whose
`wordpress.plugins` are the CMS skeleton's, the managed files below, and
the create-once scaffolding, the CMS and Frontend skeletons among it. In a
terminal it asks for the directory, project or variant its arguments lack;
elsewhere it names them and stops. The project must be lowercase letters,
digits and hyphens starting with a letter, since it names the site's
packages, Workers and DDEV project. `--variant commerce` is refused until
phase 4, and so is a target directory that isn't empty. It then prints the
provisioning sequence (fill in `gq.ops.json`, `gq sync`, `ploi provision`,
`cloudflare deploy-token`/`releases`/`media`/`ci`, `github setup`,
`ci deploy`) and runs none of it.

[`blueprint/ownership.json`](blueprint/ownership.json), published with the
package, lists every path the blueprint touches by category: fully
generated, generated section, managed keys, and create-once. Anything it
doesn't list is site-owned, and `gq sync` never reads or writes it. Only
`--variant content` is generated until phase 4.

The fully generated files are extracted from Lombardi. They are the
toolchain pins (`.mise.toml`, `.nvmrc`), the Git hooks
(`.vite-hooks/pre-commit` formats and lints staged files, `pre-push` runs
`pnpm verify`), the staged lint/format config (`vite.config.ts`), the
READMEs of `docs/adr`, `docs/plans`, `docs/research` and `docs/agents`, the
agent reference docs in `docs/agents`, and the `.claude/skills` symlink to
`../.agents/skills`. A site's own ADRs, plans and research beside those
READMEs are site-owned. The site's deploy wiring is fully generated too:
the Cloudflare CI Worker (`infra/ci`: its Wrangler config, CI and mirror
Workflows, webhook, release check and sandbox image), the Frontend deploy
configuration and script (`infra/frontend.run.ts`,
`infra/scripts/deploy-frontend.mjs`, `infra/package.json`), the CI release
step (`scripts/ci-release.mjs`) and the tests of the CI Worker and release
step (`scripts/ci.test.mjs`), and the CMS deploy script Ploi runs
(`deploy/ploi/admin.sh`).

The deploy wiring is rendered from `gq.ops.json`: the Worker, its Workflows
and its vars from `ci.worker`, `ci.backupBucket`, `artifacts`,
`cloudflare.accountId` and `github.repository`; package, Frontend Worker
and Alchemy names from `project`; the sandbox image's pnpm from the
blueprint's `packageManager` pin, and the infra package's Node engine
from its `engines.node` pin. A value `gq.ops.json` doesn't have yet is
written as a placeholder naming its key (`"<ci.worker>"`), so a new site can
be generated before it is provisioned; fill the value in and `gq sync`
rewrites the files. The Frontend deploy reads `domains` and
`cloudflare.accountId` from `gq.ops.json` when it runs.

The CMS deploy script activates the plugins `wordpress.plugins` lists, in
order (each must be installed by Composer; a name must be a plugin slug),
and prints the `<PROJECT>_DEPLOY_STATUS` line named after `project`. To add
a plugin, list it in `gq.ops.json` and run `gq sync`. Any other site step
goes in a deploy extension: each `deploy/ploi/admin.d/*.sh` runs with `bash`
from `apps/cms` after the plugins are activated and the database is updated,
in lexical (byte) order of file name, with `SITE_PATH` and `APP_PATH` set. One that exits non-zero
fails the deploy with its exit code (maintenance mode is still turned off).
Extensions run only once WordPress is installed, and not on a Composer-only
deploy. `deploy/ploi/admin.d` is the site's, created once with a README.

A site shares four more kinds of file with the blueprint:

- **Generated sections.** `AGENTS.md` holds the blueprint's base guidance
  and `.gitignore` its ignore rules, each between a `BEGIN gq` line and an
  `END gq` line. `gq sync` rewrites only what is between them; the site's
  guidance and rules go outside, before or after. A file without the
  section gets it appended; markers it can't pair (one missing, or two
  sections) stop sync with an error.
- **Managed keys.** In the root `package.json`, `gq` sets the
  `packageManager` and `engines.node` pins, the hook install (`prepare`),
  the root scripts that wrap `gq` (`verify`, `cms:*`, `ploi:*`,
  `release*` and the rest), and the ones that run the deploy wiring
  (`deploy:frontend`, `deploy:frontend:raw`, `plan:frontend`,
  `infra:check`, `ci:check`, `test:scripts`). Every other key, including
  the site's own scripts and its dependencies, is the site's: `gq` edits
  the file as text, so those keys stay byte for byte. A managed key the site removed is added
  back after its siblings, in the file's indentation. One the blueprint
  retires is removed, unless the site changed it, in which case it is the
  site's.
- **Create-once files.** `gq.ops.json`, the glossary (`GLOSSARY.md`),
  `README.md`, `VERSION`, the workspace config (`pnpm-workspace.yaml`), the
  deploy extension directory's README (`deploy/ploi/admin.d/README.md`) and
  the app skeletons are written when absent, and recorded in the lock as
  created once they exist, whoever wrote them. From then on they are the
  site's: `gq sync` never rewrites them, nor restores one the site deleted,
  unless `gq sync --recreate <path>` asks for it (repeat it for several
  files; `gq.ops.json` can't be recreated). A missing root `package.json`
  is created holding the site's own starting keys (Frontend scripts,
  `@getquick/site` pinned to the installed version, Sigillo, Vite+) before
  the managed ones.
- **App skeletons.** The CMS (`apps/cms`: Bedrock with the GETQUICK
  plugins and `getquick-theme` from the registry, the content API
  mu-plugin, DDEV config, Pint and Pest, and its env templates) and the
  Frontend (`apps/frontend`: Astro on WPGraphQL with its own copy of
  Lombardi's block renderer, its tests and its env template) are extracted
  from Lombardi without Lombardi's plugins, child theme and pages. The env
  templates hold public configuration and placeholders only
  (`gq ploi provision` renders the server's `.env` from
  `.env.production.example`).
  `deploy/ploi/admin.d/10-theme.sh`, which activates `getquick-theme`,
  belongs to the CMS skeleton. A skeleton's files are written only with
  their app: while its directory is missing, so `gq sync` never adds files
  to an app the site already has.

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
gq ploi events [--dry-run]

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

gq media check [--upload | --local] [--json]

gq frontend refresh [--uri <path>]... [--url <frontend origin>] [--json]
gq frontend events check [--url <frontend origin>] [--json]

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
line. `gq sync` generates it at `deploy/ploi/admin.sh` (see
[Generate and sync a site](#generate-and-sync-a-site)), which is what
`ploi.deployScript` should name.

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
  login (with `sigillo`), local media (`gq media check --local`) and the DDEV
  project named in `apps/cms/.ddev/config.yaml`. A missing tool, required
  file or `node_modules`, a Node below the minimum, or R2 credentials in
  `apps/cms/.env` fails it (exit 1); drift from a pin only warns.

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
- A developer can point `gq-design` (`getquick/gq-design` in Composer) at a
  local checkout with an ignored `apps/cms/.local-plugins/config.json`
  (`{ "gqDesign": "/absolute/path" }`). The old `getquickDesign` key and
  `getquick-design.php` checkout still work; conflicting keys are refused.
  The checkout's entrypoint selects the plugin slug (`gq-design.php` selects
  `gq-design`). `cms start` symlinks it over the registry copy and writes local
  DDEV files that read-only bind-mount it and run `gq cms design` (relink) and
  `gq cms design refresh` (autoload) as hooks through the site's
  `node_modules/.bin/gq`.

  After renaming a checkout from `getquick-design` to its sibling `gq-design`,
  update either config key's path and run `gq cms design` or `gq cms start`.
  An exact dangling old link with a safe registry backup is migrated; live or
  unrelated links are refused. The old backup stays at
  `.local-plugins/getquick-design-release`, separate from `gq-design-release`:
  never rename a registry backup to the other package's slug. Generated old
  DDEV mount/hook files are replaced; custom files are refused. This also
  supports rolling the checkout back to the old name and entrypoint.

  Composer dependency changes restore ordinary registry directories for both
  slugs, retain fallback backups if Composer removes a package or fails, then
  relink and rebuild autoload under the same lock. CI never consults the
  override; with no active opt-in, source symlinks under either slug prevent
  dependency changes. This does not edit a site's Composer requirements,
  lockfile, or plugin activation list; migrate those separately.

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

`gq sync` generates the site's CI Worker in `infra/ci`, with its own
Wrangler (a site that keeps one elsewhere points `ci.directory` at it);
these commands deploy and connect it:

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

## Independent media

A content site's WordPress uploads live on R2 (Human Made S3 Uploads), on a
public custom domain of their own, so a CMS outage doesn't also take down
the images its published pages reference. `cloudflare media` creates the
bucket, its domain and its key; `ploi media` points the CMS's `.env` at it;
the next CMS release activates `s3-uploads`. `gq media check` says whether
that holds, and what to do when it doesn't (exit 1 when not ready):

```sh
pnpm media:check          # gq sigillo run staging -- gq media check
pnpm media:check:upload   # … gq media check --upload
pnpm media:check:local    # gq media check --local
```

- The production check, through `gq sigillo run staging`, reads
  `gq.ops.json` `media`, `cloudflare.accountId`, `domains` and
  `wordpress.plugins`, the Ploi site's `.env` (`PLOI_API_TOKEN`; values are
  compared, never shown), the bucket through `S3_UPLOADS_KEY`/`SECRET`, the
  media domain, and the Frontend's rendered homepage. The media domain must
  be neither the CMS's host nor the Frontend's, and the homepage must not
  reference uploads on a CMS (`/app/uploads/`, `/wp-content/uploads/`).
  Passing these makes the site **configured**, not yet **ready**.
- `--upload` proves the upload path: signed in as `CMS_CHECK_USER` with the
  application password `CMS_CHECK_APP_PASSWORD` (a dedicated Author user;
  both in Sigillo `staging`), it uploads a 1×1 PNG through the CMS's REST
  media endpoint, requires WordPress to hand out a URL on the media domain,
  reads the object back from the bucket, fetches it from the media domain
  without the CMS and compares the bytes, then deletes the attachment (and
  reports an object it left behind). Only then is the site **ready**.
- `--local` checks this machine, offline and without secrets: the local CMS
  keeps uploads on disk unless `apps/cms/.env` holds R2 credentials, which
  would write to the live bucket. Local readiness says nothing about the
  production prerequisite. `gq doctor` runs the same check.
- `--json` prints `{ scope, status, ready, checks: [{ name, status, detail,
action }] }`; `status` is `ready`, `configured` or `not-ready`.

Neither the checks nor the commands they point to reset the CMS, overwrite
site-owned files or touch other `.env` lines. Availability of R2 itself is
outside the guarantee.

## Durable published content

A new content site's Frontend serves its homepage and its entries (published
pages and posts), with the menu, logo, site identity and design presets they
need, from its publication store: a D1 database of its own, declared in
`infra/frontend.run.ts` and bound to the Worker as `PUBLICATION_DB`
([ADR 0003](docs/adr/0003-serve-published-content-from-a-durable-store.md),
[ADR 0004](docs/adr/0004-serve-entries-from-the-store-with-a-cold-lookup.md)).
Visitors are served what the store holds without the Frontend reading the CMS,
so pages stay up through a CMS outage of any length and through Worker
restarts and redeploys. A refresh fills and updates the store:

```sh
pnpm frontend:refresh     # gq sigillo run staging -- gq frontend refresh
pnpm frontend:refresh --uri /about-us/       # only these entries
```

- `gq frontend refresh` posts to `https://<domains.frontend>/gq/refresh`
  (or `--url <origin>`; plain HTTP only to localhost) with
  `FRONTEND_REFRESH_TOKEN` from Sigillo `staging` as a bearer token. Without
  `--uri` it prepares the whole Site: the Frontend reads the front page, the
  chrome, and every page and post WordPress lists as published or the store
  already holds, anonymously. `--uri <path>` (repeatable, up to 100) refreshes
  only those entries, such as a new publication or a renamed one. Each
  complete, valid read is promoted; a failed one (timeout, network, HTTP,
  GraphQL, missing required data, or content without its blocks) keeps what
  was stored, and the report says why. It exits 1 unless everything asked for
  was refreshed (and, for the whole Site, the homepage is ready).
- `FRONTEND_REFRESH_TOKEN` is the site's own secret (32 characters or more,
  such as `openssl rand -hex 32`), not a Cloudflare token.
  `pnpm deploy:frontend` binds it to the Worker, and so do Cloudflare CI
  releases once `pnpm ci:deploy` has given it to the CI Worker; deployed
  without it, the Frontend refuses every refresh and keeps serving what it
  holds.
- Until a refresh has stored the front page and its chrome, pages are a 503,
  never a placeholder or a 404. A front page WordPress confirms isn't set is
  stored as missing and is a 404.
- A stored entry WordPress confirmed missing is a 404; one WordPress keeps at
  another route now redirects there (301), once a refresh has found it there.
- An entry the store has never held is looked up in the CMS on the visit:
  stored and served if published, a 404 if WordPress confirms nothing is
  there, a 503 if the CMS fails. Only public entries are stored, never
  password-protected or unpublished ones.
- A whole-Site refresh makes at least one CMS request per entry in one Worker
  invocation; on Workers' Free plan (50 subrequests) a larger site needs
  `--uri` refreshes.
- Existing sites: `infra/frontend.run.ts` only creates the store when
  `apps/frontend/migrations` exists, so a site-owned Frontend that hasn't
  adopted the files deploys as before.

### Publication events

Publishing or updating a page or post refreshes it on the Frontend without a
deploy ([ADR 0005](docs/adr/0005-refresh-publications-through-signed-cms-events.md)).
The CMS skeleton's `web/app/mu-plugins/publication-events.php` sends a signed
publication event to the Frontend's `/gq/events`; the Frontend reads that
entry from WordPress anonymously, like any refresh, and promotes it only if it
is published and complete.

```sh
pnpm ploi:events              # gq ploi events: the key into the Ploi .env, and the retry crontab
pnpm frontend:events:check    # gq frontend events check
```

- `PUBLICATION_EVENT_SECRET` is the Site's event key (32 characters or more,
  such as `openssl rand -hex 32`) in Sigillo `staging`: not the refresh token,
  a deploy token or CORS. `pnpm deploy:frontend` and CI releases bind it to the
  Worker; `gq ploi events` sets it in the Ploi site's `.env` (leaving every
  other line, never showing it), and the next CMS release applies it.
- Events are signed (HMAC-SHA256 of the timestamp and body, valid for five
  minutes) and name the Site; the Frontend refuses unsigned, stale, tampered,
  wrong-Site, unsupported and malformed ones without reading the CMS or
  changing anything. Each event has an id and the time it happened: a
  duplicate isn't processed twice, and one older than an event already
  refreshed for the same entry is superseded.
- Publishing never waits on the Frontend: the event goes out at the end of
  the request (after the editor's response under PHP-FPM, 15 seconds at most),
  and the entry records how it went. A failed delivery or refresh keeps the
  previous version served; `wp gq-events status` lists pending and failed
  events, `wp gq-events retry <post>` sends one again and `wp gq-events check`
  proves the CMS's key against the Frontend.
- `gq frontend events check` sends a signed check event, which changes
  nothing, to prove the deployed Frontend has this Site's key bound.

`scripts/smoke/frontend-runtime.sh` proves it on a disposable generated site
without Cloudflare: Alchemy's Astro build, served in workerd (Wrangler's local
mode) with a local D1 store, against a stub CMS taken down, a Worker restart,
a rebuilt redeploy, a cold lookup, a new publication, a moved entry and the
Worker's event key. `scripts/smoke/cms-events.sh` adds a real WordPress (the
pinned version, on SQLite, with WP-CLI) running the site's publication-events
plugin against that Worker: drafts, publications, updates, renames, the
Frontend down, failed refreshes, another key and a missing one.

### Shared settings

Changing the menus, the logo, the site's identity (title, tagline, icon) or
the design presets reaches every page without republishing any
([ADR 0007](docs/adr/0007-refresh-shared-settings-through-settings-events.md)).
The CMS skeleton's `web/app/mu-plugins/settings-events.php` sends a signed
`settings` event, through the publication events' endpoint, key and records,
when WordPress saves one: a menu shown at the primary location or the
locations themselves, `site_logo`, `blogname`, `blogdescription`, `site_icon`,
the theme's global styles (where GQ Design saves the palette) or the active
theme. The Frontend re-reads only the shared rows every page is served with
(the chrome, the shared design presets, and the front page for the title and
tagline), never each entry.

- Each setting's events are ordered on their own: a duplicate isn't processed
  twice, and one older than an event already refreshed for that setting is
  superseded. A failed read keeps the stored menus, branding and design, and
  the event stays recorded as failed for a retry.
- `wp gq-events settings status` lists each setting's last event and how it
  went; `wp gq-events settings retry <setting>` sends it again.
- A whole-Site refresh stores the shared design presets too; a Site last
  refreshed before them serves each page with the presets it was read with.

`scripts/smoke/cms-events.sh` changes each setting through WordPress's own
APIs (a primary menu, `site_logo`, the tagline and icon, a palette saved
through the global-styles REST route) and checks the homepage and an entry
through an outage, a failed settings refresh and its retry.

### Delivery retries

An event the Frontend didn't confirm is retried by the CMS, without visits or
republishing, and editors are told the public website is behind
([ADR 0008](docs/adr/0008-retry-event-delivery-from-the-cms-on-a-server-cron.md)).
The CMS skeleton's `web/app/mu-plugins/delivery-retries.php` reads the
entries' and the settings' delivery records as one list, whatever the event's
action, and `wp gq-events retry-due` resends each due one: the same event, so
the Frontend's ordering still holds.

- A failed delivery is retried after 1, 2, 5, 10 and 30 minutes, then hourly,
  up to 12 attempts; then it is reported as failed until an operator's
  `wp gq-events retry` or a newer event. A pending one its request never sent
  is picked up after two minutes. It covers an unreachable or refusing
  Frontend and a refresh that couldn't read WordPress back.
- The scheduler is the server's cron: `gq ploi events` adds a Ploi crontab
  running `wp gq-events retry-due --quiet` every minute as the site's system
  user. Production disables WP-Cron, which isn't used.
- Editors see a notice in the block or classic editor (being delivered,
  delayed with the reason and the next retry, failed, or recovered), "Public
  update" states in the page and post lists, and a summary on the Dashboard
  and the settings screens. Operators get the "Public website delivery" Site
  Health test and `wp gq-events delays`, which also shows the scheduler's last
  run. None of them shows the key or content.

`scripts/smoke/cms-events.sh` drives `retry-due` on a real WordPress through
dispatch and refresh failures, backoff, an interrupted request, exhausted
attempts and an overlapping run. With the local `ddev/ddev-webserver` Docker
image present (`GQ_SMOKE_CRON_IMAGE` picks another), a real cron daemon runs
the exact crontab `gq ploi events` installs and delivers a missed publication.

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

Use Node 24.21.0 (the CI version) and the pnpm version pinned in `package.json`.
The published CLI still supports Node 22.12.0+; Vite+ 1.0's development tooling
requires Node `^22.18.0 || ^24.11.0 || >=26.0.0`.

```sh
pnpm install --frozen-lockfile
pnpm exec vp run check   # Vite+ formatting/linting, then node:test
pnpm exec vp run format  # format with Vite+ (Oxfmt)
pnpm exec vp run lint    # lint with Vite+ (Oxlint)
pnpm schema             # regenerate schema/gq.ops.schema.json after changing src/manifest/schema.mjs
```

The existing `pnpm check`, `pnpm format`, `pnpm format:check`, `pnpm lint`
and `pnpm test` scripts remain available. Formatting and linting are configured
in `vite.config.ts`; generated schema, upstream skills, and extracted blueprint
and Lombardi fixtures are excluded from formatting. The extracted templates keep
their own toolchain pins. See [the migration research](docs/research/vite-plus-tooling-migration.md).

`vp check` runs static checks only; `vp run check` also runs the tests.
`vp run test` uses the existing `node:test` suite, not `vp test` (Vitest).

Tests call `run()` against a fixture site (a temporary Git repository with a
`gq.ops.json`) with recording fakes for `fetch` and `exec`
([`test/support/fixture-site.mjs`](test/support/fixture-site.mjs)). They need
no network, credentials, or provider accounts.

The Frontend skeleton's own tests, including its rendered-route tests, run in
a generated site: `scripts/smoke/frontend-check.sh` generates a disposable
content site, installs its Frontend's npm dependencies (the only step that
uses the network) and runs its tests, `astro check`, lint and format check.
`scripts/smoke/frontend-runtime.sh` is the durable published content's runtime
proof (see [Durable published content](#durable-published-content)); it also installs the CI Worker's
dependencies, for Wrangler's local workerd runtime.

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
