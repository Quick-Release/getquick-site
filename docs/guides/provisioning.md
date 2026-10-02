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
