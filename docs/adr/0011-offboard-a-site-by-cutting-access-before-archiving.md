# ADR 0011: Offboard a Site by cutting its access before archiving it

- Status: Accepted
- Date: 2026-10-03

## Context

A client is leaving: Lombardi asked to be removed from Cloudflare. Until now
nothing in gq took a Site down; the only teardown was the gq-smoke wizard's
(`scripts/smoke/gq-smoke-down.sh`), which deletes a throwaway Site outright.
A client's Site can't go that way. Its content (the database, the uploads,
the publication store) and its code must survive, and the first thing the
client wants is that nothing of theirs is reachable any more.

A Site is exposed in many places, each made by a different command: the CMS
on Ploi (its site, its retry crontab, its deploy webhook, a DNS record added
by hand), the Frontend Worker (its custom domain, workers.dev and preview
URLs), the media bucket's public domain, the CI Worker and the GitHub push
webhook that reaches it, and the project's Cloudflare tokens. Any provisioning
or deploy command run afterwards (by a person or by CI on the next tag) would
attach the domain or mint the token again.

"Withdrawal" already means an editor unpublishing content
([ADR 0006](0006-withdraw-publications-through-signed-cms-events.md)), so this
is **offboarding** (see the glossary).

## Decision

- **Two phases.** `gq offboard` cuts every public URL and every credential gq
  made, deleting nothing, and is reversible (`gq offboard --restore`). A
  second phase, `gq offboard --archive`, archives all content to one place
  and deletes the live infrastructure; it refuses unless the first is
  recorded (see "The archive" below).
- **One plan, applied in order.** The command reads everything first, prints
  a plan (`✓` already done, `-` to cut, `!` by hand), and applies only what is
  still to do after confirmation (a prompt in a terminal, `--yes` elsewhere,
  as `gq ploi provision`). Running it again cuts only what is still exposed,
  so a failed run is finished by running it again. Before calling any
  provider it refuses unless the managed deploy files
  (`infra/frontend.run.ts`, `infra/scripts/deploy-frontend.mjs`,
  `scripts/ci-release.mjs`) are as `gq sync` writes them, since an older or
  edited copy lacks the guards below. Once it has read the Ploi site, it
  refuses when the site `ploi.siteId` names isn't `domains.admin` running as
  `ploi.systemUser`, since a stale or copied ID would suspend another
  client's site (`--restore` and the archive check the same). The cut and
  the archive also refuse unless the site's `.env` (read, never written) has
  `DB_NAME` equal to `ploi.database`: Ploi's databases aren't linked to
  sites, so a copied name would back up, dump and delete another client's.
  The order:
  1. `offboarded: { "at", "phase": "cut", "cut": {} }` written to
     gq.ops.json **first**, for the operator to commit, so the guards hold
     while the cut is half done (a teammate's release or deploy refuses even
     if a later step fails);
  2. a final `gq db backup` into the backups bucket, before anything is cut;
  3. the GitHub push webhook deactivated and the CI Worker's workers.dev
     switched off, **straight after the backup**: the record isn't committed
     yet, so CI wouldn't refuse a push made mid-cut, and a release could
     re-attach what the next steps detach. A CI Worker not named
     `<project>-ci` may serve other repositories: it is reported as manual
     and left on;
  4. the CMS's retry crontab (matched as `gq ploi events` matches it), then
     the Ploi site suspended with the reason "offboarded", which keeps its
     files, `.env` and database. Ploi's API can't disable the site's deploy
     webhook (suspension is the only lever) and the CMS's DNS record was made
     by hand, so both are reported as manual;
  5. the Frontend Worker's custom domains detached, its workers.dev and
     preview URLs switched off, and the same for each of its other stages:
     a Worker named `<project>-fe-<stage>` (one word, never `fe`) whose
     `PUBLICATION_DB` binding is the D1 store
     `<project>-fe-publications-<stage>`, which is what ties it to the
     project. Any other Worker named like one (`<project>-fe-fe` is project
     `<project>-fe`'s production Worker; a hand-deployed Worker has no such
     binding) is reported as manual. The Workers and their D1 stores stay;
  6. the media bucket's custom domain disabled; the bucket stays. A media
     bucket not named `<project>-media` may serve other clients: it is
     reported as manual and its domain left on;
  7. every "GETQUICK <PROJECT> …" Cloudflare token disabled, **last**, since
     the earlier steps (and a rerun after a failure) need what they grant. A
     failure before this step leaves every token active. Tokens, GitHub hooks
     and Ploi crontabs are read across every page of their listings.

  Each step notes in `offboarded.cut` what it changed, once the change is
  made: the final backup, the retry crontab, the suspension, each detached
  Worker domain, the media domain, the webhook's ID and each disabled
  token's ID. A change that failed isn't noted, so restore never undoes what
  the cut didn't do (a token someone disabled on purpose after a failed cut
  stays disabled). Only each Worker's workers.dev setting as it was is noted
  before the change, and kept from the first run (`??=`), so the original
  survives a change that half happened; restore compares it with the live
  setting anyway.

- **The record turns on the guards.** While gq.ops.json has `offboarded`,
  every gq command that would expose the Site again refuses before reading a
  secret or calling a provider, and says to run `gq offboard --restore`:
  `cloudflare media|deploy-token|ci|releases`, `github setup`, `ci deploy`,
  `ploi provision|events|media|release`, `release push|tag`,
  `frontend refresh|secrets`, and any `ploi api` operation that writes
  (unless `--dry-run`). The generated `infra/scripts/deploy-frontend.mjs` and
  `scripts/ci-release.mjs` refuse on their own (they don't run through gq),
  and `infra/frontend.run.ts` drops the domain and every workers.dev and
  preview URL, so even a direct Alchemy deploy re-attaches nothing.
  Read-only commands (checks, `gq db backup`, `ploi api` GETs) keep working.
- **Restore reverses it, and only it.** `gq offboard --restore` brings back
  what `offboarded.cut` records and nothing else, in the reverse order: it
  re-enables those tokens (never creates them: `planToken` would "create" a
  disabled token, which would duplicate it; a token disabled before the cut
  stays disabled, shown as manual), re-enables the media domain, re-attaches
  every detached Worker domain and puts each Frontend Worker's workers.dev
  and preview URLs back as they were, resumes the Ploi site, re-adds the
  crontab only if the cut deleted one, puts the CI Worker's workers.dev back
  and reactivates the webhook, and removes `offboarded`. It refuses once the
  archive has run (`phase: "archived"`).
- **Credentials, per command.** It runs through `gq sigillo run operations`
  (`pnpm offboard`, `pnpm offboard:restore`) for the token-manager token.
  Tokens are managed with it; every other Cloudflare call goes through a
  1-hour token it mints for the run ("GETQUICK <PROJECT> offboarding
  (temporary)") and deletes afterwards. Ploi's token and the releases R2 key
  are read into memory from Sigillo staging; GitHub goes through the
  operator's `gh` login. No value is printed, and what a provider echoes back
  on failure (R2's error bodies, `gh`'s stderr) goes through
  `src/cli/redact.mjs` first; of an R2 error only its code and message are
  kept. A secret Sigillo doesn't list is reported missing; one it can't hand
  over is reported as a failed read.
- **A reusable plan.** The provider operations (`src/offboard/providers.mjs`),
  the reading of the Site and its plans (`steps.mjs`) and the plan runner
  (`plan.mjs`) are separate from the command, so the archive plans and
  applies the same way.

Choices made where the spec left room:

- The final backup counts as done once the Ploi site is suspended: a
  suspended CMS can't change its database, so the backup taken before is the
  last state. A rerun after a failure doesn't take another.
- The manager token is never disabled, even if it were named after the
  project: its ID comes from `tokens/verify` and is left out. Temporary
  tokens (names ending in "(temporary)") are left out too.
- `frontend.run.ts` omits `domain` while offboarded rather than setting it to
  `null`, which Alchemy's Website type may not accept; a removed property is
  what detaches the domain.
- A recorded media domain or webhook that is gone by the restore is reported
  as manual (`pnpm cf:media`, `pnpm github:setup`), since restoring isn't
  provisioning.
- One Sigillo environment per command, not per provider. The spec asked for
  `staging` for Ploi, GitHub and the Frontend and `operations` for tokens and
  buckets. A command runs under one `gq sigillo run`, so offboarding runs
  under `operations` (for the token-manager token) and reads the few staging
  secrets it needs (`PLOI_API_TOKEN`, the releases R2 key) into memory
  through Sigillo's CLI, never into the environment of a child process.
  GitHub needs no secret (`gh`), and the Frontend's are never read.
- The deploy-file precondition checks only the three files that carry the
  guards, not all of `gq sync --check`: other drift can't expose the Site,
  and a client's edits elsewhere shouldn't block cutting its access.
- `--dry-run` reads only, but it mints and deletes the run's temporary token,
  since the manager token can't read Workers or R2.
- Offboarding requires the whole configuration (domains, Ploi, backups,
  media, CI, Cloudflare zone, GitHub repository), named when missing, rather
  than skipping a part: every Blueprint Site has them.
- `phase` is `"cut"` or `"archived"` in the schema, so restore can refuse an
  archived Site.

### The archive (phase 2)

- **Archive, verify, then delete.** `gq offboard --archive` refuses a Site
  without the `offboarded` record. Its plan lists everything it will archive
  and delete (each DNS record by name). In a terminal it goes on only once
  the project's name is typed back; elsewhere it needs `--yes`. The archive
  goes to the private R2 bucket `offboarded-clients`, shared by every client
  and created if missing (no custom domain), under `<project>/<UTC date>/`:
  - `uploads.zip`: every object of the media bucket, keys kept, streamed
    from the bucket into a multipart upload, so neither the bucket nor the
    archive is ever held in memory or on disk. Only the project's own media
    bucket (`<project>-media`) is archived: another may hold other clients'
    uploads, so it is reported as manual, and its custom domain and DNS
    records stay;
  - `database.sql.gz`: a fresh dump, which the server uploads straight to
    the archive through a presigned URL (as `gq db backup` does);
  - `publications.sql`: the D1 store's export, and
    `publications-<stage>.sql` for each other stage's store;
  - `backups/`: copies of the Site's own database backups
    (`<backups.prefix><database>/`, where `gq db backup` writes them), or of
    everything under `backups.prefix` when the backups bucket is deleted
    whole (it is also the project's releases bucket, as usual), so nothing
    the deletion takes goes unarchived;
  - `gq.ops.json`, and `manifest.json`: each file's size and sha256 (and
    `uploads.zip`'s entry count), the source resources (buckets, the Ploi
    server, site, database and system user, the Workers, Workflows and
    container application, the D1 store's name and ID, the Artifacts
    repository, the GitHub repository and its HEAD commit, the zone, the
    Sigillo project), gq's version and the date.

  Every media object and backup copied must hold as many bytes as its
  bucket's listing says, so a body cut short without an error isn't archived
  as whole. Every file is then read back and its size and sha256 compared
  with the manifest; `uploads.zip`'s entry count must equal the media
  bucket's object count, read again. Any difference stops the run **before
  anything is deleted**. Only a verified archive is recorded, as
  `offboarded.archive: { bucket, prefix, manifestSha256 }`.

- **The deletions follow gq-smoke-down's order**: the Ploi site (and
  `ploi.siteId` forgotten in gq.ops.json, as gq-smoke-down does), its
  database and system user; the Frontend Worker and its D1 store (Alchemy
  retains a production store, so it is deleted explicitly), and each other
  stage's Worker and store; the CI Worker, its Workflows and its container
  application; the media bucket's custom domain; the media, releases and CI
  backup buckets, each emptied with a key scoped to it, then deleted; the
  Site's own backups, when the backups bucket isn't one of those; the
  Artifacts repository; the Site's own DNS records; then the project's
  tokens, deleted (phase 1 only disabled them).
- **Only what is the Site's own.** Several things the archive deletes may be
  shared, so it checks before it deletes:
  - The backups bucket is never deleted: its `prefix` exists so that it can
    be shared (Ekis's `backups-sites` holds every client's). Only the
    Site's own backups under `<backups.prefix><database>/` are deleted,
    once archived, unless the bucket is also the media, releases or CI
    backup bucket and goes whole.
  - A bucket, Worker, Workflow, container application, D1 store or
    Artifacts repository is deleted only when its name is exactly the one gq
    gives it for the project: the buckets `<project>-media`,
    `<project>-releases` and `<project>-ci-backups`, the Workers
    `<project>-fe` and `<project>-ci`, the Workflows `<project>-ci` and
    `<project>-mirror`, the container application `<project>-ci-cisandbox`,
    the D1 store `<project>-fe-publications` and the Artifacts repository
    `<project>`. Other stages' Workers and D1 stores go only when the
    `PUBLICATION_DB` binding ties them together, as in the cut; a D1 store
    named like a stage's that no stage Worker binds is manual. Anything else
    gq.ops.json points at, a sibling project's `<project>-shop-media`
    included, is listed as manual.
  - A resource is reported deleted (`✓`) only when an exact lookup finds it
    gone (a bucket, Worker or Workflow by its name), never because a listing
    left it out. Listings (Workers, container applications, D1 stores,
    tokens, Ploi's sites) are read across every page; one
    without page totals is read until an empty page, one that ignores paging
    until it repeats a page, and a Ploi listing past 50 pages stops the run
    rather than look complete.
  - The Ploi system user stays (manual) while another site on the server
    runs as it; Ploi would take that site's home with it, or refuse halfway.
  - The Ploi site is deleted only when `ploi.siteId` names `domains.admin`
    running as `ploi.systemUser`, and the database only when the site's
    `.env` names it.
    Then GitHub: the push webhook deleted and the repository archived
    (`gh repo archive`), so the code stays readable. Last, `offboarded.phase`
    becomes `"archived"` (`at` the archive's date), and the run prints the
    archive's prefix, the archived repository and the Sigillo project, which
    is kept.
- **The zone is shared.** It is the team's preview and staging domain for
  every client (`bnq.pt`), so only records named exactly as one of this
  Site's hosts (`domains.admin`, `domains.frontend`, `media.domain`) are
  deleted, and only those that serve it: `A`, `AAAA` and `CNAME`. Any other
  type at those hosts (MX, TXT, CAA) may be the client's own mail or
  verification and is listed as manual, and no record at the zone's apex is
  deleted at all. The zone and every other record stay, a subdomain of a
  Site's host included.
- **Resumable, never archived twice.** A rerun reads what is left and
  deletes only that. A recorded archive is never written again: its
  `manifest.json` must still match the recorded sha256, or the run stops
  before deleting anything else. A new archive starts only when every source
  it reads is still there (the Ploi site and database, the Frontend Worker,
  its D1 store, the media bucket), when nothing is under its prefix yet, and
  when the final backup phase 1 took is there; otherwise the run stops
  before writing anything. Either of the first two means an archive whose
  record was lost (an uncommitted gq.ops.json, another clone), which a new
  one would overwrite or miss content from. A run that fails before
  verification records nothing; its unverified files must be moved aside
  before the next run archives anew (the size-check failure says so). While the archive is
  recorded but the run unfinished, `gq offboard` and `--restore` refuse, and
  the guards point at `gq offboard --archive`. Once archived, a rerun has
  nothing to do and calls no provider.
- **Credentials.** `pnpm offboard:archive` runs it through
  `gq sigillo run operations`, like phase 1. Its temporary token can also
  delete Workers, Workflows, container applications, D1 stores, buckets and
  Artifacts repositories, and export a D1 store. R2 objects are read, written
  and deleted with keys scoped to one bucket each, minted for the run as
  1-hour tokens ("GETQUICK <PROJECT> offboarding <bucket> (temporary)") and
  deleted with it.

Choices made where the spec left room:

- The scoped keys are minted for the run rather than the project's own R2
  keys from Sigillo: phase 1 disabled those, and enabling them again would
  hand out credentials the cut took away. A scoped key still can't reach
  another client's bucket, which is what the gq-smoke cleanup relies on.
- `uploads.zip` stores its entries uncompressed (media is compressed
  already), with ZIP64 records past 4 GiB or 65,535 entries.
- The archive's resume point is gq.ops.json's record, written right after
  verification, rather than a marker in the bucket: it is what the guards and
  restore read already. A run that fails before verification leaves its
  unverified files under that day's prefix, which the next run refuses to
  write over; the operator moves them aside (or, if they are a verified
  archive whose record was lost, records it).
- The media custom domain is removed before the buckets are deleted, as
  gq-smoke-down does, so no bucket is deleted with a domain still on it.
- The Frontend Worker is deleted through Cloudflare's API, not
  `alchemy destroy`: gq doesn't run Alchemy, and a direct deploy of an
  offboarded Site refuses anyway.
- The container application is the one Wrangler names after the CI Worker
  and its sandbox class (`<ci.worker>-cisandbox`); nothing else is matched.
- Deleting something already gone (taken along by another deletion, or by a
  rerun) counts as done.
- The empty Artifacts namespace stays (gq-smoke-down can't delete one
  either), reported as manual.
- `--yes` confirms in a terminal too, as in the other offboarding commands.
- `--dry-run` reads only, but mints and deletes the run's tokens, including
  the scoped keys it lists the media and backups buckets with.

## Considered options

- **Delete at once, as gq-smoke-down does.** Rejected: irreversible before
  the content is safely archived and verified, and a client may come back.
- **An archive per client bucket.** Rejected: one shared, private bucket is
  one place to look for any former client, with one access policy.
- **Re-enable the project's bucket keys for the archive.** Rejected: see the
  scoped keys above.
- **Archive to a local file, then upload it.** Rejected: a large media
  bucket would need as much free disk; streaming needs one part in memory.
- **Disable the tokens first.** Rejected: the steps after would lose the
  credentials they need, and a failed run couldn't be finished.
- **Guard in each command.** Rejected for the gq commands: one check in the
  dispatcher, after the manifest is read and before any command runs, can't
  be forgotten by a new command's author. The deploy scripts check for
  themselves because they run outside gq.
- **Restore as the Blueprint configures it**, without remembering what was
  cut. Rejected: it re-enabled tokens disabled on purpose before the cut,
  re-attached only `domains.frontend`, and re-added a crontab the Site never
  had.
- **Match ownership by a `<project>-` prefix.** Rejected: it couldn't tell
  `acme` from a sibling project `acme-shop` (whose `acme-shop-media` a copied
  gq.ops.json might name) or `acme-fe` (whose production Worker `acme-fe-fe`
  looked like one of `acme`'s stages).
- **Note each change before making it.** Rejected: a change that failed was
  still noted, so restore could re-enable a token the cut never disabled
  and someone had disabled since.
- **Write the record last**, once everything is cut. Rejected: a failure
  halfway left the Site half cut and unguarded until a rerun.
- **Delete every bucket gq.ops.json names.** Rejected: a backups bucket can
  hold every client's backups, and nothing in gq.ops.json says a bucket is
  this Site's alone but its name.

## Consequences

- An offboarded Site's gq.ops.json must be committed and pushed with its
  record, from the branch CI deploys: an uncommitted record guards only this
  checkout, and CI's release step reads the committed one. The guide says to
  cut from an up-to-date deploy branch, push straight away, then run
  `--dry-run` again and expect every line `✓`.
- A Site without a D1 publication store (no durable delivery) can't be
  archived: the store is one of the sources a new archive requires.
- Listing GitHub's hooks needs gh 2.48 or later (`gh api --slurp`).
- The Frontend's secrets stay in Sigillo: with every URL gone they reach
  nothing, and the archive keeps the Sigillo project.
- An archived Site is gone but for its archive, its archived repository and
  its Sigillo project; bringing it back is a new provisioning from those.
- The `offboarded-clients` bucket holds every former client's content; who
  can read it is decided there, once.
- `gq offboard` reaches Cloudflare, Ploi and GitHub, so its tests run at the
  `run()` seam against one in-memory account (`test/support/offboarding.mjs`),
  R2's S3 API included.
