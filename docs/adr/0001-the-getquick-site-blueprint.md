# ADR 0001: The GETQUICK site blueprint

- Status: Accepted
- Date: 2026-09-30 (moved here from Lombardi on 2026-10-01)

## Context

GETQUICK runs more sites than it can keep up to date one repository at a
time. Lombardi and Ekis share a monorepo layout, Sigillo secrets through
`gq.ops.json`, and tooling that was vendored under `packages/tools/`, but
every copy drifts and a fix reaches only the site it was made in.

The blueprint was first proposed in a shared write-up outside any repository
and recorded as
[Lombardi's ADR 0001](https://github.com/Quick-Release/lombardi/blob/7386ac1/docs/adr/0001-follow-the-getquick-site-blueprint.md),
which said the design would move here once `getquick-site` (since renamed `gq-site`) existed. This ADR
is that record; Lombardi keeps only an ADR recording its own adoption.

Lombardi is the reference site because it already had most of the
conventions the blueprint needs: Node and pnpm are pinned (`.mise.toml`,
`packageManager`) and `doctor` checks them; `setup`, `doctor` and `verify`
exist; the pre-commit hook only formats and lints staged files and the full
check list runs pre-push; secrets come from Sigillo through `gq.ops.json`.

## Decision

Every GETQUICK site follows the blueprint, which splits a site into three
layers:

1. **Versioned packages** on npm: `@getquick/site` (the `gq` CLI), a DDEV
   add-on, the block contracts and renderer, and the agent skills.
2. **Managed files** that `gq new` and `gq sync` generate from `gq.ops.json`:
   the hook layout, toolchain pins, `setup`/`doctor`/`verify`, the CI config,
   the `docs/{adr,plans,research,agents}` skeleton, the `AGENTS.md` base, and
   the `gq.ops.json` schema.
3. **A fleet layer** (Renovate, `gq doctor --conformance`, `getquick-fleet`)
   that moves platform releases through the sites.

- **The blueprint is a CLI, not a base project.** It lives in this
  repository, released with `v*` tags and a changelog. Sites share no Git
  history with it: `gq sync` regenerates managed files from the installed
  `@getquick/site` version and never merges site forks. Reusable per-site
  differences are validated `gq.ops.json` options (such as the variant);
  site-specific behavior stays in site-owned extension points.
- **Lombardi changes first until phase 3 passes.** Until then, conventions
  change in Lombardi and the blueprint's templates are extracted from it.
  Once `gq sync` reproduces Lombardi's managed files with no diff, the
  direction flips: blueprint changes are made and released here, and reach
  Lombardi as update PRs.
- **Sites record their adoption with a link, not a copy.** The design and the
  [rollout plan](../plans/getquick-blueprint-rollout.md) live here; a site's
  own ADR records only that it follows the blueprint and any site-specific
  terms of that adoption.
- **The fleet goal is one approved platform release, rolled out
  automatically and safely across eligible sites**, not hundreds of manually
  managed update PRs. Sites keep independent repositories, deployments, and
  data.
- **No production fleet rollout precedes the safety gates** in the
  [rollout plan](../plans/getquick-blueprint-rollout.md): generation,
  cross-variant upgrades, code and data recovery, and a failed health gate
  that stops promotion. Extraction alone is not fleet readiness.
- **Two Lombardi conventions are blueprint rules**, and Ekis moves onto them
  in phase 4:
  - **Staged-only pre-commit, full checks pre-push.** The pre-commit hook
    only formats and lints staged files; the full check list (`verify`) runs
    pre-push. Ekis runs everything, including the DDEV checks, on every
    commit.
  - **Toolchain pins checked by `doctor`.** Node is pinned in `.mise.toml`
    and pnpm in `packageManager`, and `doctor` reports a running toolchain
    that doesn't match them. Ekis pins neither.
- Until their extraction phase, a site's current scripts, tools, and
  `gq.ops.json` stay in place.

The [rollout plan](../plans/getquick-blueprint-rollout.md) holds the accepted
requirements, phases, and gates; the
[update-mechanics and fleet review](../research/getquick-blueprint-update-mechanics.md)
holds the supporting evidence. Phase 2's design (one manifest, its schema and
migrations, the lock file, ownership categories, declarative plugins) is
[ADR 0002](0002-generate-sites-from-a-versioned-manifest.md). Moving
third-party agent skills out of site repositories is a separate decision,
[Lombardi's ADR 0002](https://github.com/Quick-Release/lombardi/blob/main/docs/adr/0002-install-third-party-agent-skills.md).

## Considered options

- **A template repository that sites fork and merge from.** Every site
  becomes a long-lived fork, and each upgrade is a merge against whatever
  that site changed, so conflicts grow with every site and release.
  Generating managed files from a validated manifest makes an upgrade a
  regeneration of files nobody edits by hand.
- **One shared platform** (WordPress Multisite, a shared runtime, or a shared
  tenant database). It couples every client's uptime, data, and deploys: a
  bad release or a restore hits every site at once. Independent sites driven
  by a central rollout give the same one-release updates without that
  coupling.
- **Keep vendoring shared tools in each site** (Lombardi's former
  `packages/tools/`). A fix must be copied into every site by hand, and the
  copies drift. Versioned packages let Renovate propose the update
  everywhere.

## Consequences

- After phase 3, managed-file changes originate here and reach sites through
  checked update PRs. Unexpected local edits to managed files stop
  synchronization instead of being silently discarded; site-owned files stay
  under the site's control.
- Standardization does not remove per-site builds, lockfiles, migrations, or
  health checks; it makes running them automatic and observable.
- Progressive rollout is slower than deploying everywhere at once but bounds
  the impact of a bad release. The fleet can be partially upgraded while
  compatibility guarantees hold; exceptions cannot outlast the declared
  support policy.
