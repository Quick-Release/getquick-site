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

Two checks come first, and stop the run before anything changes:

- **The deploy files are current.** `infra/frontend.run.ts`,
  `infra/scripts/deploy-frontend.mjs` and `scripts/ci-release.mjs` must be as
  `gq sync` writes them: older or edited copies lack the guards that keep a
  deploy from exposing the Site again. Run `gq sync` (`gq sync --check` shows
  what it changes) and commit, then offboard.
- **`ploi.siteId` is the Site's CMS.** The Ploi site it names must be
  `domains.admin`; a stale or copied ID would suspend another client's site.

The plan marks each item `✓` (already done), `-` (to cut) or `!` (by hand),
and is applied in this order:

| Part     | What happens                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record   | `offboarded: { "at": …, "phase": "cut" }` is written to `gq.ops.json` first, so the guards hold even if a later step fails. Commit it once the cut is done.                           |
| Backup   | `gq db backup` of the live database into the backups bucket, before anything is cut.                                                                                                  |
| CMS      | The retry crontab is deleted and the Ploi site suspended ("offboarded"); its files, `.env` and database stay.                                                                         |
| Frontend | The Worker's custom domains are detached and its workers.dev and preview URLs switched off, and its other stages' (`<project>-fe-<stage>`) too. The Workers and their D1 stores stay. |
| Media    | The media bucket's custom domain is disabled. The bucket and its uploads stay.                                                                                                        |
| CI       | The GitHub push webhook is deactivated and the CI Worker's workers.dev switched off.                                                                                                  |
| Tokens   | Every `GETQUICK <PROJECT> …` Cloudflare token is disabled, last, since the steps before need them. The token-manager token is never touched.                                          |

As it goes, the cut notes in `offboarded.cut` each thing it changes (the
crontab, the suspension, each detached domain, each Worker's workers.dev
setting as it was, the media domain, the webhook and each token it disabled):
restore brings back those and nothing else. Commit `gq.ops.json`: it is what
keeps gq, the deploy scripts and CI from exposing the Site again.

Two things are yours to do by hand, and the plan says so:

- **The CMS's deploy webhook.** Ploi's API can't disable it; the suspension
  is what stops it.
- **The CMS's DNS record** (`domains.admin`), added by hand when the Site was
  provisioned. Remove it if it should go.

The Frontend's secrets stay in Sigillo; with every URL gone, they reach
nothing.

Running `pnpm offboard` again cuts only what is still exposed, so a run that
failed halfway is finished by running it again. A failure before the tokens
step leaves every token active, and the record already guards the Site.
A Worker named like a Frontend stage but with more hyphens
(`<project>-fe-shop-fe`) may be another project's: the plan lists it for you
to check, and leaves it alone. Once the Ploi site is suspended the backup
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

`gq offboard --restore` reverses what the cut recorded in `offboarded.cut`,
tokens first: it re-enables the tokens the cut disabled (never creating new
ones; a token that was disabled before stays so, and the plan says it),
puts each Worker's workers.dev and preview URLs back as they were,
reactivates the webhook, re-enables the media domain, re-attaches every
domain the cut detached, resumes the Ploi site, re-adds the retry crontab if
the cut deleted one, and removes `offboarded`. Add back by hand a DNS record
you removed. Then release and deploy as usual, and run `pnpm site:check`.

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
| `publications.sql` | The Frontend's D1 publication store, exported (and `publications-<stage>.sql` for each other stage's).                          |
| `backups/`         | Copies of the Site's own database backups (`<backups.prefix><database>/`), the cut's final backup among them.                   |
| `gq.ops.json`      | The Site's manifest as it was.                                                                                                  |
| `manifest.json`    | Each file's size and sha256, and where everything came from: buckets, Ploi IDs, Workers, the D1 store, the repository's HEAD.   |

Each media object and backup must hold as many bytes as its bucket lists.
Then every file is read back and checked against `manifest.json`, and
`uploads.zip`'s entries are counted against the media bucket's objects. **If
anything differs, the run stops before deleting anything.** Only a verified
archive is recorded in `gq.ops.json` (`offboarded.archive`: its bucket, prefix
and `manifest.json`'s sha256).

A new archive refuses to start, before writing anything, when:

- something under `<project>/<UTC date>/` is there already: gq never archives
  over it. Move unverified files aside; if they are a verified archive whose
  record was lost, put `offboarded.archive` back in `gq.ops.json` instead;
- a source is gone (the Ploi site or database, the Frontend Worker, its D1
  store, the media bucket) while no archive is recorded: a new archive would
  miss it, so the record of the one that was made must come back;
- the final backup the cut took isn't in the backups bucket.

### What is deleted

In this order, only after the archive is recorded:

| Part      | What happens                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ploi      | The site (and `ploi.siteId` in `gq.ops.json`), its database and its system user, unless another site on the server runs as it.                                                                                |
| Frontend  | The Worker and its D1 publication store, and every other stage's.                                                                                                                                             |
| CI        | The CI Worker, its Workflows and its container application.                                                                                                                                                   |
| Media, R2 | The media bucket's custom domain; then the media, releases and CI backup buckets, each emptied with a key scoped to it, and deleted. The backups bucket stays: only the Site's own backups in it are deleted. |
| Artifacts | The Artifacts repository. The empty namespace stays (the plan says so).                                                                                                                                       |
| DNS       | The `A`, `AAAA` and `CNAME` records named exactly as the Site's hosts: `domains.admin`, `domains.frontend` and `media.domain`. Each is listed in the plan.                                                    |
| Tokens    | Every `GETQUICK <PROJECT> …` token, deleted last on Cloudflare.                                                                                                                                               |
| GitHub    | The push webhook is deleted and the repository archived: read-only, its code and history kept.                                                                                                                |
| Record    | `offboarded.phase` becomes `"archived"`. Commit `gq.ops.json`.                                                                                                                                                |

The zone is shared with other Sites (`bnq.pt` holds every client's staging
hosts): it is never deleted, and neither is any record that isn't one of the
Site's own hosts, a subdomain of them included. Other record types at those
hosts (MX, TXT, CAA: perhaps the client's mail or verification) and every
record at the zone's apex are listed for you instead.

Some of what `gq.ops.json` names may be shared, so the archive deletes only
what is named as the project's own: a bucket, Worker, Workflow, container
application, D1 store or Artifacts repository is deleted only when its name is
the project's or starts with `<project>-`. Anything else is listed for you
(`!`) and left alone.

The run ends by printing where everything is: the archive's prefix and
`manifest.json`'s sha256, the archived repository, and the Sigillo project,
which is kept with the Site's secrets.

### If it fails halfway

Run it again. A recorded archive is never written again (its `manifest.json`
must still match the recorded sha256, or nothing more is deleted), and only
what is still there is deleted. Until the run finishes, `gq offboard` and
every guarded command point you back at `pnpm offboard:archive`, and
`--restore` refuses. A run that failed before verification leaves its files
under that day's prefix, which the next run won't write over: move them aside
first.
