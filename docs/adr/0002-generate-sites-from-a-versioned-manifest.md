# ADR 0002: Generate sites from one versioned manifest

- Status: Accepted
- Date: 2026-10-01

## Context

Phase 2 of the [rollout plan](../plans/getquick-blueprint-rollout.md) builds
`gq new` and `gq sync` ([spec #1](https://github.com/Quick-Release/getquick-site/issues/1)).
Before it, everything around `@getquick/site` was copied per site: the hooks,
toolchain pins, docs skeleton, `AGENTS.md` base, CI Worker config, frontend
deploy scripts and CMS deploy script existed only as Lombardi's files.
`gq.ops.json` had no schema or version: `gq` only checked that it was an
object with a `project`, every command read its own keys ad hoc, and
Lombardi's and Ekis's files had different shapes (Ekis still carried the
removed `credentials` and GitHub Actions `secrets`/`variables` flows). The
release and verify settings lived in a second, unvalidated JS module
(`shop-devtools.config.mjs`). Nothing could tell a hand edit of a generated
file from a template update.

## Decision

- **One manifest.** `gq.ops.json` is the only site manifest. The release
  config module is folded into it: the blueprint's defaults for the variant
  (checks, release paths, version files, required files) come from `gq`, and
  the manifest holds only site values and additions (extra version files and
  text patterns, extra checks, extra release paths).
- **Versioned schema with migrations.** `gq.ops.json` has an integer
  top-level `schemaVersion`; a file without one is v0, the unvalidated shape
  sites had before phase 2. zod is the single source of the schema, and a JSON
  Schema for editors (`$schema`) is generated from it. Every command reads the
  parsed, validated manifest, and writes (such as `ploi provision` recording
  the site ID) go through a validated writer. Migrations are pure functions
  from vN to vN+1: `gq sync` applies them and writes the file back, and
  `gq sync --check` reports them as pending. Commands refuse a manifest older
  than they support (pointing at `gq sync --manifest`) or newer than the
  installed `gq`, so no command guesses at an unknown shape.
- **v1.** v1 is Lombardi's v0 keys plus `schemaVersion`, `variant`
  (`content` or `commerce`), a `wordpress.plugins` list, and the folded
  release/verify additions. `domains` has the fixed roles `admin` and
  `frontend` and an optional `docs`, not an open map. The v0 to v1 migration
  drops Ekis's `credentials` and `github.secrets`/`github.variables` blocks
  and names each dropped key. v1 still describes one deployment per site; an
  environment axis is later fleet work.
- **Ownership categories.** A file-ownership manifest published with the
  package classifies every path the blueprint touches:
  - **fully generated**: the whole file is rewritten from the templates
    (in phase 2: the Git hook layout, the toolchain pins, the staged
    lint/format config, the docs skeleton's READMEs and agent reference
    docs, the agent-skills symlink, the Cloudflare CI Worker config, the
    frontend deploy configuration and script, the CI release step, and the
    CMS deploy script);
  - **generated section**: begin/end markers in a text file, with site
    content outside them (the `AGENTS.md` base, the ignore file);
  - **managed keys**: key-level ownership in the root `package.json` (the
    package manager and engine pins, the hook-install script, and the root
    scripts that wrap `gq`);
  - **create-once**: written only when absent and never restored after the
    site deletes it, unless `gq sync --recreate <path>` asks for it
    (`gq.ops.json`, the glossary and README, the CMS deploy extension
    directory, the env templates, the workspace config, and the CMS and
    Frontend app skeletons).

  Anything not listed is site-owned and never touched.

- **A lock file.** `gq.lock.json`, committed at the site root, records the
  `gq` version, the schema version, a content hash for each managed file and
  section, and which create-once files have been created. A managed file or
  section whose current hash differs from the lock is a local edit: `gq sync`
  stops, prints a diff against what it would write, and writes nothing.
- **Declarative plugins, site-owned deploy extensions.** The CMS deploy
  script is fully generated. Its activation step comes from
  `wordpress.plugins`, so adding a plugin can no longer miss a hand-written
  activation loop. After activation it runs the site's deploy extensions (a
  create-once directory of site-owned scripts) in lexical order, and a
  non-zero exit from any of them fails the deploy. Site-specific steps, such
  as retiring an old plugin or a one-off data migration, live there and
  survive regeneration. The deploy status line keeps its per-project form;
  renaming it is a phase 4 decision.
- **Generation holds no authority.** `gq new` and `gq sync` need no network
  access and no secrets. Generated env templates contain public
  configuration and placeholders only; secrets stay per-command Sigillo
  injections.

## Considered options

- **Keep the release config as a second module.** Each site would keep a
  drifting copy of the blueprint's default checks and release paths, and the
  module can't be validated or migrated like the manifest.
- **Infer a manifest's shape from its keys.** Lombardi's and Ekis's files
  already overlap in ways that make inference a guess; an explicit version
  makes each migration a tested, deterministic step.
- **Overwrite managed files unconditionally, or three-way merge them.**
  Overwriting silently discards a hand edit; merging turns every site back
  into a fork of the templates ([ADR 0001](0001-the-getquick-site-blueprint.md)).
  Stopping with a diff keeps the edit and makes the site choose.
- **Keep the activation loop in a site-owned deploy script.** Every site
  would own a copy of the whole deploy, so a fix to it reaches no one, and a
  missed plugin fails silently.
- **Ekis's `overrides` and `gq link`** (its ADR 0008). Not adopted: they
  reopen the open-ended per-site switches the blueprint avoids. That ADR's
  "setup writes env files from Sigillo" is ruled out by the rollout plan, and
  the ADR is superseded when Ekis adopts the blueprint in phase 4.
