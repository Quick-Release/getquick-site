# Provisioning and deployment

[Documentation](../README.md)

## Ploi provisioning and releases

After [generating or adopting a site](sites.md) and
[configuring Sigillo](secrets.md), these run through `gq sigillo run <environment> --`, which injects
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
[Generate and sync a site](sites.md)), which is what
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
public custom domain of their own, so a CMS outage doesn't also take down the
images its published pages reference. `cloudflare media` creates the bucket,
its domain and its key; `ploi media` points the CMS's `.env` at it; the next
CMS release activates `s3-uploads`. `gq media check` says whether that holds,
and what to do when it doesn't (exit 1 when not ready):

```sh
pnpm media:check          # gq sigillo run staging -- gq media check
pnpm media:check:upload   # … gq media check --upload
pnpm media:check:local    # gq media check --local
```

- The production check, through `gq sigillo run staging`, reads `gq.ops.json`
  `media`, `cloudflare.accountId`, `domains` and `wordpress.plugins`, the Ploi
  site's `.env` (`PLOI_API_TOKEN`; values are compared, never shown), the
  bucket through `S3_UPLOADS_KEY`/`S3_UPLOADS_SECRET`, the media domain, and
  the Frontend's rendered homepage. The media domain must be neither the CMS's
  host nor the Frontend's, and the homepage must not reference uploads on a
  CMS (`/app/uploads/`, `/wp-content/uploads/`). Passing these makes the site
  **configured**, not yet **ready**.
- `--upload` proves the upload path: signed in as `CMS_CHECK_USER` with the
  application password `CMS_CHECK_APP_PASSWORD` (a dedicated Author user; both
  in Sigillo `staging`), it uploads a 1×1 PNG through the CMS's REST media
  endpoint, requires WordPress to hand out a URL on the media domain, reads
  the object back from the bucket, fetches it from the media domain without
  the CMS and compares the bytes, then deletes the attachment (and reports an
  object it left behind). Only then is the site **ready**.
- `--local` checks this machine, offline and without secrets: the local CMS
  keeps uploads on disk unless `apps/cms/.env` holds R2 credentials, which
  would write to the live bucket. Local readiness says nothing about the
  production prerequisite. `gq doctor` runs the same check.
- `--json` prints `{ scope, status, ready, checks: [{ name, status, detail,
action }] }`; `status` is `ready`, `configured` or `not-ready`.

Neither the checks nor the commands they point to reset the CMS, overwrite
site-owned files or touch other `.env` lines. Availability of R2 itself is
outside the guarantee.

## Durable homepage

A new content site's Frontend serves its homepage, with the menu, logo, site
identity and design presets it needs, from its publication store: a D1 database
of its own, declared in `infra/frontend.run.ts` and bound to the Worker as
`PUBLICATION_DB`
([ADR 0003](../adr/0003-serve-published-content-from-a-durable-store.md)).
Visitors never make the Frontend read the CMS, so the homepage stays up
through a CMS outage of any length and through Worker restarts and redeploys.
A refresh fills and updates the store:

```sh
pnpm frontend:refresh     # gq sigillo run staging -- gq frontend refresh
```

- `gq frontend refresh` posts to `https://<domains.frontend>/gq/refresh` (or
  `--url <origin>`; plain HTTP only to localhost) with
  `FRONTEND_REFRESH_TOKEN` from Sigillo `staging` as a bearer token. The
  Frontend reads the front page and the chrome from the CMS, anonymously, and
  promotes each complete, valid read; a failed one (timeout, network, HTTP,
  GraphQL, missing required data, or a front page without its blocks) keeps
  what was stored, and the report says why. It exits 1 unless everything was
  refreshed and the homepage is ready.
- `FRONTEND_REFRESH_TOKEN` is the site's own secret (32 characters or more,
  such as `openssl rand -hex 32`), not a Cloudflare token.
  `pnpm deploy:frontend` binds it to the Worker; deployed without it, the
  Frontend refuses every refresh and keeps serving what it holds. Cloudflare CI
  releases don't pass it yet.
- Until a refresh has stored the front page and its chrome, the homepage is a
  503, never a placeholder or a 404. A front page WordPress confirms isn't set
  is stored as missing and is a 404.
- Existing sites: `infra/frontend.run.ts` only creates the store when
  `apps/frontend/migrations` exists, so a site-owned Frontend that hasn't
  adopted the files deploys as before.

`scripts/smoke/frontend-runtime.sh` proves it on a disposable generated site
without Cloudflare: Alchemy's Astro build, served in workerd (Wrangler's local
mode) with a local D1 store, against a stub CMS taken down, a Worker restart
and a rebuilt redeploy.
