# Renaming `getquick-site` to `gq-site`

An inventory of every place the name `getquick-site` appears, in this
repository, on GitHub, on npm, in sibling repositories and on the local
machine, and an ordered plan for renaming it to `gq-site`. Researched on
2026-10-02 against `main` at `45d372d`. Nothing was renamed. Repository facts
cite `file:line`. Local facts cite the command that showed them. External
facts cite the page that was fetched. Anything not checked against a source
is marked **unverified**.

## Summary

- **What the rename covers.** `getquick-site` is the repository's name only.
  The npm package is `@getquick/site` (`package.json:2`) and the command is
  `gq` (`package.json:8`). `GLOSSARY.md:18-19` lists all three as the
  blueprint's code names. Renaming the repository doesn't require renaming
  the package, and renaming the package would be a separate, much larger
  decision (see [Decisions](#decisions)).
- **Size.** There are 26 tracked occurrences of `getquick-site` in 17 files
  (`git grep -c -i -E 'getquick[-_]?site'`), plus 2 tracked file names.
  There are no occurrences of `getquick_site`, `getquickSite` or
  `GetquickSite`. Most of the other ~400 `getquick` hits are the GETQUICK
  brand or names of other products and must stay.
- **GitHub.** Renaming redirects issues, the web UI and git operations.
  Nothing this repository has depends on what doesn't redirect: there is no
  Pages site, no action consumed via `uses:`, no webhooks, deploy keys,
  rulesets or branch protection.
- **npm.** The published metadata (`repository`, `homepage`, `bugs`) still
  points at `Quick-Release/getquick-site` until the next publish. The package
  name doesn't change.
- **Cloudflare.** Nothing to rename. This repository has no Worker, Pages
  project, wrangler config or binding of its own.
- **Local fallout.** This is the largest risk. 11 linked worktrees use absolute
  gitdir paths into `/data/code/getquick/getquick-site/.git`. One of them
  (`unknown/getquick-site/viteplus`) has uncommitted changes. Claude Code's
  project state and memory, and a pi session directory, are keyed by path.

## 1. In-repository occurrences

The search: `git grep -n -i -E 'getquick[-_]?site'`, then `git grep -n -i
'getquick'` for the rest, and `git ls-files | grep -i getquick` for file
names. `pnpm-lock.yaml` has no `getquick` hits (`grep -c`: 0).

### 1a. Repository name: rename to `gq-site`

| Location                                                      | Text                                                                                               | Note                                                                                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json:54`                                             | `git+https://github.com/Quick-Release/getquick-site.git`                                           | Published to npm as `repository`. `npm view` shows `homepage` and `bugs` derived from it (observed; see §3).                                                          |
| `AGENTS.md:7`                                                 | `Issues live in GitHub Issues on Quick-Release/getquick-site`                                      | Agents read this to target `gh`.                                                                                                                                      |
| `README.md:1`                                                 | `# getquick-site`                                                                                  | Title.                                                                                                                                                                |
| `GLOSSARY.md:3`, `:18`                                        | `` `getquick-site` holds the blueprint…``, `` `getquick-site` (repository)``                       | The code-name list. Update it to `gq-site`, and record the old name if you want it searchable.                                                                        |
| `gq.ops.json:2`                                               | `"project": "getquick-site"`                                                                       | Here `project` is only a display name. `gq doctor` shows it (`src/workspace/doctor.mjs:27`). See the note below the table.                                            |
| `src/ops/providers/ploi.mjs:21`                               | ``"User-Agent": `getquick-site/${VERSION}` ``                                                      | The User-Agent every site's Ploi call sends. Behaviour visible to Ploi; record it in the changelog (`CHANGELOG.md:428` recorded the previous change, from `gq-ops/`). |
| `test/run.test.mjs:293`                                       | the same User-Agent                                                                                | Must change together with `ploi.mjs:21`.                                                                                                                              |
| `scripts/publish.mjs:62`                                      | `mkdtempSync(join(tmpdir(), "getquick-site-publish-"))`                                            | Temp-dir prefix. Cosmetic.                                                                                                                                            |
| `test/support/fixture-site.mjs:30`                            | `mkdtemp(join(tmpdir(), "getquick-site-"))`                                                        | Temp-dir prefix. Cosmetic.                                                                                                                                            |
| `blueprint/templates/AGENTS.md:6`                             | `[`@getquick/site`](https://github.com/Quick-Release/getquick-site)`                               | **A managed section** (`blueprint/ownership.json:55-57`, `generatedSections`): the next `gq sync` rewrites it in every site.                                          |
| `blueprint/templates/GLOSSARY.md:22`                          | `[getquick-site's glossary](https://github.com/Quick-Release/getquick-site/blob/main/GLOSSARY.md)` | **Create-once** (`blueprint/ownership.json:66-68`): only new sites get the new link. Existing sites keep the old URL, which redirects (§2).                           |
| `blueprint/templates/README.md:4`                             | `https://github.com/Quick-Release/getquick-site`                                                   | Create-once (`blueprint/ownership.json:69`), the same as above.                                                                                                       |
| `docs/adr/0002-…manifest.md:9`                                | `https://github.com/Quick-Release/getquick-site/issues/1`                                          | The link still works through the redirect. Optional.                                                                                                                  |
| `docs/plans/getquick-blueprint-rollout.md:10`, `:149`, `:152` | `…/getquick-site/issues/2`, `/1`, `/7`                                                             | Issue links. They still work through the redirect. Optional.                                                                                                          |

About `gq.ops.json` `project`: in a site, `project` names Cloudflare tokens
(`GETQUICK <PROJECT> …`, `src/cloudflare/tokens.mjs:17-18`), Ploi databases
(`src/ploi/provision.mjs:53`) and DB-sync markers (`src/db/sync.mjs:200`).
This repository's `gq.ops.json` has only a `sigillo` block, so none of those
commands apply and nothing external is named from it. The Sigillo project is
addressed by ID (`gq.ops.json:5`; `scripts/publish.mjs:47-53` passes
`projectId`), so renaming `project` can't break publishing. Whether the
Sigillo project's display name at `secrets.getquick.io` is `getquick-site`
is **unverified**. It wasn't checked, because doing so needs Sigillo
credentials. If it is, renaming it is cosmetic.

### 1b. Historical prose: decide whether to keep or rewrite

These describe the past, or use the name as a proper noun in decision
records:

- `CHANGELOG.md:428`: the 0.1.0 entry "Ploi requests identify as
  `getquick-site/<version>`". **Keep.** Changelog entries are history.
- `docs/adr/0001-the-getquick-site-blueprint.md:15-16` ("once `getquick-site`
  existed"), `docs/plans/getquick-blueprint-rollout.md:9`, `:159` ("The
  `getquick-site` repository was created at the start of phase 1"). These are
  historical. Rewrite them, or add a note such as "(renamed `gq-site` on …)".
- `docs/adr/0001-…:15` links Lombardi's ADR at a pinned commit (`blob/7386ac1`).
  That link is unaffected.

### 1c. File names that contain the name

`git ls-files | grep -i getquick`:

- `docs/adr/0001-the-getquick-site-blueprint.md`. Linked from
  `GLOSSARY.md:5`, `README.md:10`, `docs/adr/0002-…:95`,
  `docs/plans/getquick-blueprint-rollout.md:4` and
  `docs/research/getquick-blueprint-update-mechanics.md:3`. **It also has a
  deep link from outside this repository**: Lombardi's
  `docs/adr/0003-lombardi-adopts-the-getquick-site-blueprint.md:12` links
  `…/getquick-site/blob/main/docs/adr/0001-the-getquick-site-blueprint.md`.
  The repository redirect fixes the repository segment but not a renamed file
  path. Renaming this file breaks that link unless Lombardi is updated too.
- `docs/research/getquick-site-tooling-inventory.md`. "GETQUICK site
  tooling" here reads as the domain term (a GETQUICK **Site**,
  `GLOSSARY.md:11-14`), not the repository. Keep it.
- `docs/plans/getquick-blueprint-rollout.md` and
  `docs/research/getquick-blueprint-update-mechanics.md` are named after the
  brand, not the repository. Keep them. Lombardi deep-links both
  (`clients/lombardi/docs/adr/0001-…:55,66,68`,
  `docs/adr/0002-…:103`).

### 1d. `getquick` hits that are not the repository name: keep

From `git grep -o -h -i -E '[A-Za-z0-9@./_-]*getquick[A-Za-z0-9./_-]*' | sort | uniq -c`:

- **Brand:** `GETQUICK` (98 hits; for example `GLOSSARY.md:1`), `GetQuick`,
  the `GETQUICK_*` environment variables, the `GETQUICK <PROJECT> …` token
  prefix (`src/cloudflare/tokens.mjs:18`,
  `scripts/smoke/cloudflare-cleanup.mjs:76`), and the `doctor` fallback name
  (`src/workspace/doctor.mjs:27`).
- **npm scope and package:** `@getquick/site` (55 hits; `package.json:2`,
  `src/manifest/schema.mjs:18`, `src/workspace/doctor.mjs:23`). See
  [Decisions](#decisions).
- **Other products and repositories:** `getquick-design`, `getquick-theme`,
  `getquick-config`, `getquick-registry` (`scripts/smoke/gq-smoke-up.sh:444-446`),
  `getquick-fleet` (`docs/adr/0001-…:36`), the Composer vendor `getquick/…`
  (`blueprint/templates/apps/cms/composer.json:35,54`), and the CSS classes
  `wp-block-getquick-design-*`.
- **Domains:** `secrets.getquick.io` (`gq.ops.json:4`),
  `proxy.composer.getquick.io`.
- **Keywords:** `package.json:57` `"getquick"`.
- **Temp-dir prefixes:** `getquick-exec-` (`test/exec.test.mjs:57,74`),
  `getquick-composer-` and similar. Generic. Optional.

### 1e. Places checked that have no occurrences

- `.github/workflows/ci.yml`: no repository name and no badges. It uses only
  `actions/*` and `pnpm/action-setup`.
- `.claude/settings.json`: permission rules only, with no name. `.claude/skills`
  is a symlink to `../.agents/skills` (`ls -la .claude/skills`). A grep found
  no `getquick-site` in `.agents/`.
- **Release tooling.** No compare links and no embedded repository URL. The
  release is a manual tag plus `pnpm release:publish` → `scripts/publish.mjs`.
  That script checks that the tag `v<version>` points at HEAD, then runs
  `npm publish` under `sigillo run` (`scripts/publish.mjs:33-70`).
  `CHANGELOG.md` headings carry no links (`CHANGELOG.md:6`).
- **Git hooks:** none in this repository (`.git/hooks` has only samples; no
  `core.hooksPath`). The `vite-hooks/` directory is a site template
  (`blueprint/templates/vite-hooks/`).
- **README badges:** none.
- `git remote -v`: `origin git@github.com:Quick-Release/getquick-site.git`.
  Local branch config also tracks `origin` for 10 branches (`git config
--get-regexp branch`). Those entries name the remote, not the URL, so they
  survive a `set-url`.

## 2. The GitHub repository

### What GitHub does on a rename

From [Renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)
(fetched 2026-10-02):

- "all existing information, with the exception of project site URLs, is
  automatically redirected to the new name", including issues, wikis, stars
  and followers.
- "All `git clone`, `git fetch`, or `git push` operations targeting the
  previous location will continue to function", but GitHub "strongly
  recommend[s] updating any existing local clones" with `git remote set-url
origin NEW_URL`.
- **Pages:** project site URLs are not redirected. GitHub recommends a custom
  domain for any repository with a Pages site.
- **Actions:** "GitHub will not redirect calls to an action hosted by a
  renamed repository. Any workflow that uses that action will fail with the
  error `repository not found`."
- **Reusing the old name:** "do not reuse the original name of the renamed
  repository. If you do, redirects to the renamed repository will no longer
  work."
- Only organization owners or repository admins can rename.
- **API redirect: unverified on this page.** The page's wording covers "all
  existing information". Separately, GitHub's REST docs describe 301
  redirects for renamed repositories, but that page wasn't fetched for this
  research.
- **Not covered by the page:** secrets, environments, deploy keys,
  rulesets and webhooks. They are attached to the repository, which keeps its
  ID through a rename (an inference, not a documented statement), so they
  carry over. None of them exist here except one environment (below).

`gh repo rename [<new-name>] [-R OWNER/REPO] [-y]` performs the rename
(`gh repo rename --help`, gh 2.46.0). No dry-run flag exists.

### What this repository has (read-only `gh api`, 2026-10-02)

| Check                                    | Result                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `repos/Quick-Release/getquick-site`      | public, created 2026-09-30, `has_pages: false`, 0 stars, 0 forks, `homepage: null` |
| `/hooks`                                 | `[]`                                                                               |
| `/environments`                          | 1: `copilot` (created 2026-10-02, no protection rules)                             |
| `/pages`                                 | 404 (no Pages site)                                                                |
| `/deployments`                           | `[]`                                                                               |
| `/keys` (deploy keys)                    | `[]`                                                                               |
| `/rulesets`                              | `[]`                                                                               |
| `/branches/main/protection`              | 404 "Branch not protected"                                                         |
| `/actions/secrets`, `/actions/variables` | 0 and 0                                                                            |
| `/autolinks`                             | `[]`                                                                               |
| `/releases`                              | 0 (15 local tags, no GitHub Releases)                                              |
| issues, PRs                              | 34 issues and 2 PRs, all states (`gh issue list` / `gh pr list --state all`)       |
| `/installation` (apps)                   | Not readable with a user token (401). **Unverified.**                              |
| org rulesets                             | Needs the `admin:org` scope. **Unverified.**                                       |
| `Quick-Release/gq-site`                  | Doesn't exist (`gh repo view`: "Could not resolve"), so the name is free           |

Nothing relies on the parts that don't redirect: there is no Pages site, and
no `uses: Quick-Release/getquick-site@…` anywhere in the organization (code
search below found no workflow hits).

### Other repositories that reference the name

`gh search code "getquick-site" --owner Quick-Release` returns, outside this
repository:

- **Quick-Release/lombardi** (private): `AGENTS.md`, `README.md`,
  `GLOSSARY.md`, `CHANGELOG.md`, `handoff.md`, `docs/adr/0001-…`,
  `0002-…`, `0003-…`. These include the generated `AGENTS.md` section
  (`clients/lombardi/AGENTS.md:239`) and the file deep links noted in §1c.
- **Quick-Release/gq-smoke** (private): `AGENTS.md`, `README.md`,
  `CONTEXT.md`.
- Ekis, cesam and apa didn't appear. A local grep of
  `/data/code/getquick/{clients,internal,wp-plugins,gq-ops}` found only
  Lombardi.

All of these are URLs, which redirect, or prose. None breaks on the rename
except a deep link to a renamed file (§1c).

## 3. External integrations

### npm

- The package is public and named `@getquick/site` (`package.json:2`,
  `publishConfig.access: public` at `package.json:49-51`). It is published by
  `scripts/publish.mjs` (`npm publish --access public`, line 66). This is
  the "publishing" that commit `93253ef` allows (`.claude/settings.json`
  `Bash(pnpm release:publish)`).
- `npm view @getquick/site` (2026-10-02): `version 0.13.1`, `repository.url
git+https://github.com/Quick-Release/getquick-site.git`, `homepage
…/getquick-site#readme`, `bugs …/getquick-site/issues`. These come from
  `package.json:52-55`. They update only when a new version is published with
  the new `repository` URL (observed behaviour; the claim that existing
  versions' metadata is immutable is **unverified** against npm docs). The
  old URLs keep working through GitHub's redirect.
- **The package name doesn't change** with a repository rename. `gq-site` is
  unclaimed on npm (`npm view gq-site`: 404), but renaming the package would
  mean publishing a new package, deprecating `@getquick/site`, and changing
  every site's `devDependencies`, `SCHEMA_URL`
  (`src/manifest/schema.mjs:18`, a `node_modules/@getquick/site/…` path
  written into every site's `gq.ops.json`) and the `doctor` package check
  (`src/workspace/doctor.mjs:23`). That is out of scope unless the user
  decides otherwise.

### Cloudflare

Nothing in this repository is a Cloudflare resource. The only wrangler files
are the site template `blueprint/templates/infra/ci/wrangler.jsonc` and the
fixture `test/fixtures/lombardi/infra/ci/wrangler.jsonc` (`git ls-files |
grep wrangler`). Cloudflare names that `gq` creates for sites come from each
site's own `project` (`src/cloudflare/tokens.mjs:17-18`), not from this
repository's name. So no Worker, Pages project, route, binding or token needs
renaming. Cloudflare's [wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
page defines `name` ("The name of your Worker…") but doesn't say what
changing it does. Rename semantics weren't researched further, because they
don't apply here.

### Sigillo

The project is addressed by an opaque ID (`gq.ops.json:5`), so a rename can't
break it. Its display name is **unverified** (§1a).

## 4. Local machine fallout

### Worktrees

`git worktree list` (2026-10-02) shows the main worktree and 10 linked
worktrees under `/data/agents/workspaces/claude/getquick-site/`: `issue-13`
(detached), `issue-14`, `phase4-ekis-dry-run`, and seven `research-*`. It also
shows one linked worktree at `/data/agents/workspaces/unknown/getquick-site/viteplus`
on branch `viteplus`. **That one has 10 uncommitted changes**
(`git status --porcelain | wc -l`). Every other worktree is clean. No
legacy-layout (`/data/agents/workspaces/getquick-site-*`) worktree exists, and
there is nothing under `codex/`, `pi/` or `zcode/`.

The links are absolute in both directions:
`.git/worktrees/issue-14/gitdir` →
`/data/agents/workspaces/claude/getquick-site/issue-14/.git`, and that
worktree's `.git` → `gitdir: /data/code/getquick/getquick-site/.git/worktrees/issue-14`.
`worktree.useRelativePaths` is unset, and git is 2.53.0.

From [git-worktree](https://git-scm.com/docs/git-worktree):

- `move` can't move the main worktree. "The `git worktree repair` command,
  however, can reestablish the connection with linked worktrees if you move
  the main worktree manually."
- "if the main worktree … is moved, linked worktrees will be unable to locate
  it. Running `repair` in the main worktree will reestablish the connection
  from linked worktrees back to the main worktree."
- "If both the main worktree and linked worktrees have been moved … running
  `repair` in the main worktree and specifying the new <path> of each linked
  worktree will reestablish all connections in both directions."
- `worktree.useRelativePaths` / `--relative-paths` link with relative paths,
  "particularly useful for setups where the repository and worktrees may be
  moved". It implies `extensions.relativeWorktrees`.

So:

- **Moving only the main repository**
  (`mv /data/code/getquick/getquick-site /data/code/getquick/gq-site`): run
  `git worktree repair` inside `/data/code/getquick/gq-site`.
- **Also moving the worktree directories** to
  `/data/agents/workspaces/claude/gq-site/<task>`: run `git worktree repair
<each new path>` from the main worktree. Alternatively, prune or finish the
  stale research worktrees before the move, so there is less to repair.

The wrapper derives the repository name from `basename "$(git rev-parse
--show-toplevel)"` (`~/.claude/scripts/claude-wrapper.sh:94`) and puts
worktrees at `${WORKSPACES_ROOT}/${repo_name}/${task_name}` (`:96`). After
the move, `claude -w <task>` creates new worktrees under
`/data/agents/workspaces/claude/gq-site/`. An existing task directory
left under `…/getquick-site/` isn't found, so a second worktree for the same
task would be created. Its legacy fallback (`:97-102`) only checks the flat
`<repo>-<task>` layout. The repository isn't under `/data/code/vh`, so the
account selection (`:32`) doesn't change.

### Claude Code state

- Per-project state lives under `~/.claude/projects/<project>/`. Its
  documented key derivation, from the purge example in
  [Explore the .claude directory](https://code.claude.com/docs/en/claude-directory),
  maps `/home/user/work/my-repo` to `~/.claude/projects/-home-user-work-my-repo`
  and to `projects["/home/user/work/my-repo"]` in `~/.claude.json`.
  [Memory](https://code.claude.com/docs/en/memory) says: "The `<project>`
  path is derived from the git repository, so all worktrees and
  subdirectories within the same repo share one auto memory directory." It
  also documents `autoMemoryDirectory` for pinning memory elsewhere.
- **Observed:** `~/.claude/projects/-data-code-getquick-getquick-site/` (8.2
  MB) holds 5 session transcripts and `memory/` (`MEMORY.md`,
  `commit-claude-settings.md`). The memory content itself says "In
  getquick-site…", so update the wording too. The worktrees have their own
  transcript directories
  (`-data-agents-workspaces-claude-getquick-site-{issue-13,issue-14,phase4-ekis-dry-run}`)
  without `memory/`, which matches the docs.
- After the move, the key becomes `-data-code-getquick-gq-site` (derived by
  the documented pattern). To keep memory and `--resume` history, move the
  directory before the first session there: `mv
~/.claude/projects/-data-code-getquick-getquick-site
~/.claude/projects/-data-code-getquick-gq-site`. Whether resuming old
  sessions works after such a move is **unverified**. Transcripts embed the
  old `cwd`.
- `~/.claude.json` has a `projects["/data/code/getquick/getquick-site"]`
  entry (trust, allowed tools, MCP toggles, among other keys; values not
  printed). After the move Claude Code asks for trust again. You can copy the
  entry to the new key while Claude Code isn't running.
- `~/.claude/history.jsonl` has 51 lines that mention `getquick-site`
  (`grep -c`). They hold the project path, so up-arrow history won't follow.
  This is cosmetic.
- This repository isn't under `/data/code/vh`, so `~/.claude-work` holds
  nothing for it (`ls ~/.claude-work/projects/*getquick-site*`: no match).

### Other agents

- **pi:** `~/.pi/agent/sessions/--data-agents-workspaces-unknown-getquick-site-viteplus--/`
  (3 entries) is keyed by the `viteplus` worktree path. This is probably the
  agent that created the `unknown/` workspace (**unverified**). It goes stale
  if that worktree moves.
- **codex, zcode:** no config or state files outside sessions mention
  `getquick-site` (`grep -rIl` over `~/.codex/*.toml|*.json` and
  `~/.zcode`).
- **Lombardi's `handoff.md`** contains the literal commands `gh repo clone
Quick-Release/getquick-site /data/code/getquick/getquick-site` and `cd
/data/code/getquick/getquick-site` (`clients/lombardi/handoff.md:58-59,80,100,111`).
  After the move they are stale instructions.

## 5. Ordered plan

Steps marked ⚠ are outward-facing or hard to undo.

1. **Prepare.** Commit or stash the 10 changes in
   `/data/agents/workspaces/unknown/getquick-site/viteplus`. Finish, merge or
   remove the worktrees you no longer need (`git worktree remove`) so there
   is less to repair. Make sure no Claude, pi or codex session is running in
   the repository or its worktrees.
2. ⚠ **Rename on GitHub**: `gh repo rename gq-site -R Quick-Release/getquick-site`
   (or Settings → Repository name). GitHub redirects the old name, so nothing
   breaks immediately. It is reversible by renaming back, as long as no one
   has created a new `getquick-site` in the meantime. **Never create a
   repository named `getquick-site` in Quick-Release afterwards**, because
   that kills the redirects.
3. **Update remotes**: `git remote set-url origin
git@github.com:Quick-Release/gq-site.git` in the main repository. The
   linked worktrees share its config. Also update any other clone (for
   example on CI machines or other laptops; none were found locally).
4. **Code and docs PR** in this repository (`gq-site`): `package.json:54`,
   `AGENTS.md:7`, `README.md:1`, `GLOSSARY.md:3,18`, `gq.ops.json:2`, the
   User-Agent (`src/ops/providers/ploi.mjs:21` plus `test/run.test.mjs:293`),
   the three blueprint templates (`blueprint/templates/{AGENTS,GLOSSARY,README}.md`),
   the optional temp-dir prefixes and issue links, and a CHANGELOG entry.
   Decide on the ADR file name (§1c) and the historical prose (§1b). Run
   `pnpm check`.
5. ⚠ **Release** (tag `v<next>`, `pnpm release:publish`). This publishes npm
   metadata that points at `gq-site`, and ships the new User-Agent and
   templates. It can't be undone: npm versions can't be republished.
6. **Sites:** after they bump `@getquick/site` and run `gq sync`, the managed
   `AGENTS.md` section picks up the new link. Their create-once `README.md`
   and `GLOSSARY.md` keep the old URL, which redirects. Optionally hand-edit
   Lombardi's ADR links, `GLOSSARY.md` and `handoff.md`, and gq-smoke's
   `README.md` and `CONTEXT.md`.
7. **Local folder move** (no session running):
   - `mv /data/code/getquick/getquick-site /data/code/getquick/gq-site`
   - Optionally `mv /data/agents/workspaces/claude/getquick-site
/data/agents/workspaces/claude/gq-site`, and the same for `unknown/`.
   - `cd /data/code/getquick/gq-site && git worktree repair [<each new worktree path>…]`
   - Check the result with `git worktree list` and `git -C <worktree> status`.
   - Consider `git config worktree.useRelativePaths true` plus `git worktree
repair --relative-paths` to make future moves painless. This needs git
     2.48 or newer for every client (**unverified** version floor).
8. **Claude Code state:** `mv ~/.claude/projects/-data-code-getquick-getquick-site
~/.claude/projects/-data-code-getquick-gq-site`, plus the worktree
   transcript directories if you moved the worktrees. Re-key the
   `~/.claude.json` project entry, or accept the trust prompt. Edit the
   memory wording. Do the same for the pi session directory if `viteplus`
   moved.
9. **Verify:** `gh repo view` inside the new folder, `git fetch`, `pnpm
check`, `claude -w test-rename` (it should land under
   `/data/agents/workspaces/claude/gq-site/`), and `npm view @getquick/site
repository` after the release.

Steps 2 and 3 are independent of step 7. The folder move doesn't need the
GitHub rename, and the other way round. Doing the GitHub rename first means
the PR in step 4 lands in the renamed repository and its links are valid
immediately.

## Decisions

1. **Rename the npm package too?** The default is to keep `@getquick/site`.
   `GLOSSARY.md:18` already treats the repository and package as separate
   code names, and renaming the package touches every site (§3).
2. **Rename the ADR file `0001-the-getquick-site-blueprint.md`?** This breaks
   Lombardi's deep link unless Lombardi is updated too (§1c). The default is
   to keep the file name.
3. **Rewrite historical prose** (ADR 0001, the rollout plan) or annotate it
   (§1b)? Changelog entries stay as they are.
4. **Change the Ploi User-Agent** to `gq-site/<version>`? It is
   outward-facing but harmless. Note it in the changelog.
5. **Change `gq.ops.json` `project`** to `gq-site`? It is only a display name
   here (§1a).
6. **Move the worktree directories** to `…/claude/gq-site/`, or leave them
   and let new worktrees use the new path? What should happen to the
   `unknown/` workspace?
7. **Update sibling repositories** (Lombardi, gq-smoke) now, or rely on
   redirects and the next `gq sync`?
8. **Keep every `GETQUICK`/`getquick` brand string?** The recommendation is
   yes (§1d).
