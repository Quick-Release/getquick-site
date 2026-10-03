# Offboarding a Site

[Documentation](../README.md)

When a client leaves, offboarding takes their Site down without losing any of
it ([ADR 0011](https://github.com/Quick-Release/gq-site/blob/main/docs/adr/0011-offboard-a-site-by-cutting-access-before-archiving.md)).
It has two phases:

1. **Cut** (`gq offboard`, reversible): every public URL and every credential
   gq made for the Site is cut. Nothing is deleted: the CMS's files and
   database, the Frontend Worker and its store, the buckets and the code all
   stay.
2. **Archive** (`gq offboard --archive`, irreversible): all content goes to
   one archive, which is verified, and only then is the live infrastructure
   deleted. It needs the cut recorded first.

## Cut a Site's access

```sh
pnpm offboard --dry-run       # the plan, nothing changed
pnpm offboard                 # the plan, then a prompt
git add gq.ops.json && git commit -m "chore: offboard the Site"
```

`pnpm offboard` runs `gq offboard` through `gq sigillo run operations`, for
the account's token-manager token. Ploi's token and the releases bucket's R2
key are read from Sigillo staging, and the GitHub webhook goes through your
`gh` login (it needs admin on the repository). Outside a terminal, pass
`--yes`.

The plan marks each item `✓` (already done), `-` (to cut) or `!` (by hand),
and is applied in this order:

| Part     | What happens                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup   | `gq db backup` of the live database into the backups bucket, before anything is cut.                                                                           |
| CMS      | The retry crontab is deleted and the Ploi site suspended ("offboarded"); its files, `.env` and database stay.                                                  |
| Frontend | The Worker's custom domain is detached and its workers.dev and preview URLs switched off. The Worker and its D1 publication store stay.                        |
| Media    | The media bucket's custom domain is disabled. The bucket and its uploads stay.                                                                                 |
| CI       | The GitHub push webhook is deactivated and the CI Worker's workers.dev switched off.                                                                           |
| Tokens   | Every `GETQUICK <PROJECT> …` Cloudflare token is disabled, last, since the steps before need them. The token-manager token is never touched.                   |
| Record   | `offboarded: { "at": …, "phase": "cut" }` is written to `gq.ops.json`. Commit it: it is what keeps gq, the deploy scripts and CI from exposing the Site again. |

Two things are yours to do by hand, and the plan says so:

- **The CMS's deploy webhook.** Ploi's API can't disable it; the suspension
  is what stops it.
- **The CMS's DNS record** (`domains.admin`), added by hand when the Site was
  provisioned. Remove it if it should go.

The Frontend's secrets stay in Sigillo; with every URL gone, they reach
nothing.

Running `pnpm offboard` again cuts only what is still exposed, so a run that
failed halfway is finished by running it again. A failure before the tokens
step leaves every token active. Once the Ploi site is suspended the backup
counts as done: a suspended CMS can't change its database, so the backup
taken before it is the final one.

## While a Site is offboarded

Every command that would expose the Site again refuses, and names
`gq offboard --restore`:

- `gq cloudflare media`, `deploy-token`, `ci`, `releases`
- `gq github setup`, `gq ci deploy`
- `gq ploi provision`, `events`, `media`, `release`, and any `gq ploi api`
  operation that writes (`--dry-run` still prints the request)
- `gq release push`, `gq release tag`
- `gq frontend refresh`, `gq frontend secrets`
- `pnpm deploy:frontend` (`infra/scripts/deploy-frontend.mjs`) and CI's release
  step (`scripts/ci-release.mjs`); `infra/frontend.run.ts` drops the domain and
  every workers.dev and preview URL, so even a direct Alchemy deploy
  re-attaches nothing.

Checks, `gq db backup` and `gq ploi api` GETs keep working.

## Restore a Site

```sh
pnpm offboard:restore --dry-run
pnpm offboard:restore
git add gq.ops.json && git commit -m "chore: restore the Site"
```

`gq offboard --restore` reverses the cut, tokens first: it re-enables the
project's tokens (never creating new ones), switches the CI Worker's
workers.dev back on and reactivates the webhook, re-enables the media domain,
re-attaches `domains.frontend` and the Frontend's preview URLs as
`infra/frontend.run.ts` configures them, resumes the Ploi site, re-adds the
retry crontab, and removes `offboarded`. Add back by hand a DNS record you
removed. Then release and deploy as usual, and run `pnpm site:check`.

Restore refuses once the Site's archive is recorded.

## Archive a Site

Once the cut is recorded (and committed), and nobody expects the Site back:

```sh
pnpm offboard:archive --dry-run   # the plan, nothing changed
pnpm offboard:archive             # the plan, then type the project's name
git add gq.ops.json && git commit -m "chore: archive the Site"
```

`pnpm offboard:archive` runs `gq offboard --archive` through
`gq sigillo run operations`, like the cut. In a terminal it goes on only once
you type the project's name back; elsewhere it needs `--yes`. **This can't be
undone**: everything but the archive, the GitHub repository and the Sigillo
project is deleted.

### What is archived

Everything goes to the private R2 bucket `offboarded-clients`, shared by every
former client (created if missing, with no public domain), under
`<project>/<UTC date>/`:

| File               | What it is                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `uploads.zip`      | Every object of the media bucket, keys kept as paths. Streamed from the bucket to the archive, never held in memory or on disk. |
| `database.sql.gz`  | A fresh dump of the CMS database (still there, on the suspended site).                                                          |
| `publications.sql` | The Frontend's D1 publication store, exported.                                                                                  |
| `backups/`         | Copies of the database backups in the backups bucket (`db/`), the cut's final backup among them.                                |
| `gq.ops.json`      | The Site's manifest as it was.                                                                                                  |
| `manifest.json`    | Each file's size and sha256, and where everything came from: buckets, Ploi IDs, Workers, the D1 store, the repository's HEAD.   |

Then every file is read back and checked against `manifest.json`, and
`uploads.zip`'s entries are counted against the media bucket's objects. **If
anything differs, the run stops before deleting anything**; run it again to
archive anew. Only a verified archive is recorded in `gq.ops.json`
(`offboarded.archive`: its bucket, prefix and `manifest.json`'s sha256).

### What is deleted

In this order, only after the archive is recorded:

| Part      | What happens                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Ploi      | The site (and `ploi.siteId` in `gq.ops.json`), its database and its system user.                                                     |
| Frontend  | The Worker and its D1 publication store.                                                                                             |
| CI        | The CI Worker, its Workflows and its container application.                                                                          |
| Media, R2 | The media bucket's custom domain; then the media, releases and CI backup buckets, each emptied with a key scoped to it, and deleted. |
| Artifacts | The Artifacts repository. The empty namespace stays (the plan says so).                                                              |
| DNS       | The records named exactly as the Site's hosts: `domains.admin`, `domains.frontend` and `media.domain`. Each is listed in the plan.   |
| Tokens    | Every `GETQUICK <PROJECT> …` token, deleted last on Cloudflare.                                                                      |
| GitHub    | The push webhook is deleted and the repository archived: read-only, its code and history kept.                                       |
| Record    | `offboarded.phase` becomes `"archived"`. Commit `gq.ops.json`.                                                                       |

The zone is shared with other Sites (`bnq.pt` holds every client's staging
hosts): it is never deleted, and neither is any record that isn't one of the
Site's own hosts, a subdomain of them included.

The run ends by printing where everything is: the archive's prefix and
`manifest.json`'s sha256, the archived repository, and the Sigillo project,
which is kept with the Site's secrets.

### If it fails halfway

Run it again. A recorded archive is never written again (its `manifest.json`
must still match the recorded sha256, or nothing more is deleted), and only
what is still there is deleted. Until the run finishes, `gq offboard` and
every guarded command point you back at `pnpm offboard:archive`, and
`--restore` refuses. A run that failed before verification on an earlier
day leaves its files under that day's prefix; delete them by hand.
