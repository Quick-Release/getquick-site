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
  so a failed run is finished by running it again. The order:
  1. a final `gq db backup` into the backups bucket, before anything is cut;
  2. the CMS's retry crontab (matched as `gq ploi events` matches it), then
     the Ploi site suspended with the reason "offboarded", which keeps its
     files, `.env` and database. Ploi's API can't disable the site's deploy
     webhook (suspension is the only lever) and the CMS's DNS record was made
     by hand, so both are reported as manual;
  3. the Frontend Worker's custom domains detached, its workers.dev and
     preview URLs switched off; the Worker and its D1 store stay;
  4. the media bucket's custom domain disabled; the bucket stays;
  5. the GitHub push webhook deactivated and the CI Worker's workers.dev
     switched off;
  6. every "GETQUICK <PROJECT> …" Cloudflare token disabled, **last**, since
     the earlier steps (and a rerun after a failure) need what they grant. A
     failure before this step leaves every token active;
  7. `offboarded: { "at", "phase": "cut" }` written to gq.ops.json, for the
     operator to commit.
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
- **Restore reverses it.** `gq offboard --restore` re-enables the tokens
  (never creates them: `planToken` would "create" a disabled token, which
  would duplicate it), switches CI's workers.dev back on and reactivates the
  webhook, re-enables the media domain, re-attaches the Frontend's domain and
  its preview URLs as `frontend.run.ts` configures them, resumes the Ploi site,
  re-adds the crontab, and removes `offboarded`. It refuses once the archive
  has run (`phase: "archived"`).
- **Credentials, per command.** It runs through `gq sigillo run operations`
  (`pnpm offboard`, `pnpm offboard:restore`) for the token-manager token.
  Tokens are managed with it; every other Cloudflare call goes through a
  1-hour token it mints for the run ("GETQUICK <PROJECT> offboarding
  (temporary)") and deletes afterwards. Ploi's token and the releases R2 key
  are read into memory from Sigillo staging; GitHub goes through the
  operator's `gh` login. No value is printed.
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
- Restore switches the CI Worker's workers.dev on without choosing its
  preview URLs (Cloudflare's default); its `wrangler.jsonc` doesn't set them.
- Restore re-attaches only `domains.frontend`. Another domain that was on the
  Worker isn't restored; a missing media domain or webhook is reported as
  manual (`pnpm cf:media`, `pnpm github:setup`), since restoring isn't
  provisioning.
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
    archive is ever held in memory or on disk;
  - `database.sql.gz`: a fresh dump, which the server uploads straight to
    the archive through a presigned URL (as `gq db backup` does);
  - `publications.sql`: the D1 store's export;
  - `backups/`: copies of the database backups in the backups bucket;
  - `gq.ops.json`, and `manifest.json`: each file's size and sha256 (and
    `uploads.zip`'s entry count), the source resources (buckets, the Ploi
    server, site, database and system user, the Workers, Workflows and
    container application, the D1 store's name and ID, the Artifacts
    repository, the GitHub repository and its HEAD commit, the zone, the
    Sigillo project), gq's version and the date.

  Every file is then read back and its size and sha256 compared with the
  manifest; `uploads.zip`'s entry count must equal the media bucket's object
  count, read again. Any difference stops the run **before anything is
  deleted**. Only a verified archive is recorded, as
  `offboarded.archive: { bucket, prefix, manifestSha256 }`.

- **The deletions follow gq-smoke-down's order**: the Ploi site (and
  `ploi.siteId` forgotten in gq.ops.json, as gq-smoke-down does), its
  database and system user; the Frontend Worker and its D1 store (Alchemy
  retains a production store, so it is deleted explicitly); the CI Worker,
  its Workflows and its container application; the media bucket's custom
  domain; the media, releases and CI backup buckets, each emptied with a key
  scoped to it, then deleted; the Artifacts repository; the Site's own DNS
  records; then the project's tokens, deleted (phase 1 only disabled them).
  Then GitHub: the push webhook deleted and the repository archived
  (`gh repo archive`), so the code stays readable. Last, `offboarded.phase`
  becomes `"archived"` (`at` the archive's date), and the run prints the
  archive's prefix, the archived repository and the Sigillo project, which
  is kept.
- **The zone is shared.** It is the team's preview and staging domain for
  every client (`bnq.pt`), so only records named exactly as one of this
  Site's hosts (`domains.admin`, `domains.frontend`, `media.domain`) are
  deleted. The zone and every other record stay, a subdomain of a Site's
  host included.
- **Resumable, never archived twice.** A rerun reads what is left and
  deletes only that. A recorded archive is never written again: its
  `manifest.json` must still match the recorded sha256, or the run stops
  before deleting anything else. A run that fails before verification
  records nothing, and the next run archives anew. While the archive is
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
  restore read already. A run that fails before verification on another day
  leaves its unverified files under that day's prefix, for deleting by hand.
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
- **Remember what was cut in gq.ops.json** (domain IDs, previous workers.dev
  settings) to restore it exactly. Rejected: restore brings the Site back as
  the Blueprint configures it, which is what a later deploy would do anyway.

## Consequences

- An offboarded Site's gq.ops.json must be committed with its record: an
  uncommitted record guards only this checkout, and CI's release step reads
  the committed one.
- The Frontend's secrets stay in Sigillo: with every URL gone they reach
  nothing, and the archive keeps the Sigillo project.
- An archived Site is gone but for its archive, its archived repository and
  its Sigillo project; bringing it back is a new provisioning from those.
- The `offboarded-clients` bucket holds every former client's content; who
  can read it is decided there, once.
- `gq offboard` reaches Cloudflare, Ploi and GitHub, so its tests run at the
  `run()` seam against one in-memory account (`test/support/offboarding.mjs`),
  R2's S3 API included.
