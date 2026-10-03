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
  recorded. This ADR covers the first phase; the archive adds its own
  decisions here when it lands.
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
- `phase` is `"cut"` or `"archived"` in the schema now, so restore can refuse
  an archived Site; the archive's own fields come with it.

## Considered options

- **Delete at once, as gq-smoke-down does.** Rejected: irreversible before
  the content is safely archived and verified, and a client may come back.
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
- `gq offboard` reaches Cloudflare, Ploi and GitHub, so its tests run at the
  `run()` seam against one in-memory account (`test/support/offboarding.mjs`).
