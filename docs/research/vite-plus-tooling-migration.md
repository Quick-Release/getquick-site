# Migrating GETQUICK site development tooling to Vite+

Researched on 2026-10-02 against the repository's pre-migration baseline
`45d372d8706eefc94383f3a274d2f03658b4e5dd`, live official Vite+ documentation,
published package APIs/artifacts, and official source repositories. This is
research, not an ADR or a claim that migration is complete. Implementation was
proceeding concurrently; the inventory below describes the baseline inspected
at the start, not subsequent worktree changes.

## Recommendation

Adopt **project-local `vite-plus@1.0.0`** for **Oxfmt instead of Prettier** and
**Oxlint instead of ESLint**, retaining pnpm and the existing Node test runner.
Keep the aggregate quality gate as **`vp check && vp run test`**, not just
`vp check`. Do not add a Vite application build or a tsdown packaging step to
this source-distributed CLI/library solely to satisfy a generic migration
checklist. A global `vp` installation is optional. [1], [2], [3], [4].

The blocking environment change is CI's **Node 22.12.0**: the published Vite+
package requires **`^22.18.0 || ^24.11.0 || >=26.0.0`**. Pin a supported development
and CI runtime; **24.21.0** was the runtime used for the command verification
here. Keep the library's public `engines.node` contract separate if consumers
still support 22.12.0. The migrator explicitly treats public engines separately
and does not automatically fix Node versions embedded in CI workflows. [1], [5].

## Repository inventory and scope

Primary local evidence: [`package.json`](../../package.json),
[CI workflow](../../.github/workflows/ci.yml), and the baseline versions of
`eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, and
`pnpm-lock.yaml` at the revision above.

| Baseline                                                                                                   | Applicable migration                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier `^3.8.2`, lockfile 3.9.9; `printWidth: 100`                                                       | `vp fmt`, with options in root `vite.config.*` → `fmt`                                                                                |
| ESLint `^10.0.3`, lockfile 10.11.0; `@eslint/js` recommended; Node globals from `globals`; JS/MJS override | `vp lint`, with translated rules/globals/ignores in `lint`; remove `eslint`, `@eslint/js`, and then `globals` if no longer referenced |
| `check = pnpm format:check && pnpm lint && pnpm test`                                                      | Preserve tests: `vp check && vp run test`                                                                                             |
| `test = node --test "test/*.test.mjs"`                                                                     | Keep initially; `vp run test` executes that script. `vp test` does **not**                                                            |
| ESM CLI/library; `bin/gq.mjs`, exports `src/index.mjs`; published source/assets, no root build script      | No current Vite/Rollup/tsup/tsdown build to replace                                                                                   |
| `pnpm@12.6.0`, frozen-lockfile CI                                                                          | Keep the pin; either pnpm directly or `vp install` can install it                                                                     |
| `schema`, `release:publish`, Sigillo, `@clack/prompts`, `aws4fetch`, Zod                                   | Application/release/secret tooling, not replaced by Vite+                                                                             |

The root was **not** a pnpm workspace at baseline. The package manifests,
workspace settings, and Vite configs inside `blueprint/templates/` are shipped
**template data**, not evidence that this package is itself that site monorepo.
Those templates already pin **Vite+ 0.3.0 / Vitest 4.1.11** in
[`blueprint/templates/pnpm-workspace.yaml`](../../blueprint/templates/pnpm-workspace.yaml).
Treat upgrading their toolchain as a separate change with generated-site
validation, not an incidental root migration.

Preserve formatter exclusions for `.agents/`, `schema/`, `blueprint/templates/`,
and `test/fixtures/lombardi/`. The last two are explicitly byte-preserved
upstream/template material. **Formatter exclusions do not establish lint
exclusions**: baseline ESLint only ignored `node_modules/**` and `coverage/**`.
If migration excludes templates/fixtures from lint too, record that as a
scope decision rather than claiming identical coverage.

## Verified release, installation, and package managers

### Published release, not an assumed preview

On the research date, npm `latest` resolved to **1.0.0**, also available at its
explicit version endpoint. The published package and live test guide agree on
Vitest **5.0.1** and the Node range above. Older 0.x examples or a Node-20 CI
matrix are not evidence that current `vite-plus` supports Node 20. [1], [5].

`pnpm dlx --package=vite-plus@1.0.0 vp toolchain` reported:

| Component                  | Verified bundled version          |
| -------------------------- | --------------------------------- |
| Vite+ / core               | 1.0.0 / 1.0.0                     |
| Vite / Rolldown            | 8.3.1 / 1.2.11                    |
| Vitest                     | 5.0.1                             |
| Oxlint / type-aware helper | 1.85.0 / oxlint-tsgolint 7.0.2003 |
| Oxfmt                      | 0.70.0                            |
| tsdown                     | 0.23.0                            |

This command and the exact-version `vp --version`, `vp help migrate`,
`vp help fmt`, `vp help lint`, and `vp help check` were actually executed in
**disposable `/tmp` directories** with **pnpm 12.6.0 / Node 24.21.0**. They passed;
this verifies package availability, command syntax, and that pnpm combination,
not application/test compatibility. The temporary fetch reported peer warnings;
it was not a complete project install or peer-graph validation. [1], [2].

### Applicable command paths

**Local-only, controlled manual adoption** (commands for a later implementation,
not executed against this repository by this research):

```sh
# First select a supported Node runtime using the existing runtime manager.
pnpm add -D --save-exact vite-plus@1.0.0
pnpm exec vp toolchain
pnpm exec vp help check
```

Before completing installation, configure the package-manager aliases/pins
below. This manual route avoids automatic hook/editor/agent setup and wholesale
migration edits. Scripts can call bare `vp`: package-manager script execution
resolves `node_modules/.bin`, so contributors need not install a global CLI. [2]

**Official automatic migration alternative:** keep original dependencies and
lockfile installed/available, and use the target migrator **before** installing
Vite+ into the project:

```sh
pnpm dlx --package=vite-plus@1.0.0 vp help migrate
pnpm dlx --package=vite-plus@1.0.0 vp migrate --no-interactive --no-agent --no-editor --no-hooks
```

These migration flags were verified in the published CLI help. Explicit opt-outs
matter: hooks are the non-interactive default. The migrator modifies manifests,
imports, configs, scripts, lockfiles and selected formatting; it is not a dry
run. Review every warning/REVIEW finding even when it exits successfully.
Upgrading to Vite 8+/Vitest 4.1+ first applies to projects **already using those
tools**; this root has neither and does not need artificial prerequisites. [3], [6].

**Optional global installation:** [7]

```sh
# macOS/Linux; pins the installer rather than following latest
curl -fsSL https://vite.plus | VP_VERSION=1.0.0 bash
# Windows PowerShell: official installation entrypoint
irm https://vite.plus/ps1 | iex
```

The global CLI can manage Node and package managers and delegates project tools
to the local package. Machine management is optional; use `vp env off` to prefer
system tools. Local-only `vp env`, `vp upgrade`, and `vp implode` are not
available. Do not require developers to replace their existing runtime manager
for a lint/format migration. [2], [7].

### pnpm and dependency alignment

Vite+ supports **pnpm, npm, Yarn, and Bun**; `packageManager` takes precedence in
manager detection. `pnpm@12.6.0` is supported by explicit version selection and
was used in the smoke commands above. Vite+ wraps the package manager rather
than replacing its lockfile or approval policies. Yarn PnP is unsupported;
migration converts it to `nodeLinker: node-modules`. [6], [8].

For this pnpm version, root overrides belong in `pnpm-workspace.yaml`. The
migration rules recommend `@*` selector keys to preserve catalog references:

```yaml
# Single-package root settings; do not add blueprint directories as members.
overrides:
  "vite@*": npm:@voidzero-dev/vite-plus-core@1.0.0
  "vitest@*": 5.0.1
```

The core alias must match Vite+, and Vitest must match its bundled runner to
avoid duplicate Vite identities and split Vitest mocks/expect/state. No new
direct `vite` or `vitest` dependency is required merely to use `vite-plus` in a
pnpm package with no upstream peers/imports. The local-install guide has a
simpler bare-key example; the migration-rules guide explains the more precise
`@*` form. Update these pins together on subsequent upgrades. [2], [6].

## Commands and one-file configuration

Use `defineConfig` from `vite-plus` in a root `vite.config.ts` (or supported
JS/MJS/CJS/MTS/CTS variant). Tool blocks are **`lint`, `fmt`, `check`, `test`,
`pack`, `run`, and `staged`**; ordinary Vite options remain at the top level.
Do not introduce separate `.oxlintrc.json`, `.oxfmtrc.json`, or
`vitest.config.ts` as the final Vite+ setup. [9]

| Command                                              | Behavior / applicability                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `vp fmt . --write`                                   | Oxfmt writes formatting; bare `vp fmt` also writes by default                             |
| `vp fmt . --check`                                   | Read-only formatting gate                                                                 |
| `vp lint .` / `vp lint . --fix`                      | Oxlint / safe autofixes; dangerous/suggestion fixes require separate flags                |
| `vp check`                                           | **Static** format + lint + optional type-check gate; never the unit tests                 |
| `vp check --fix`                                     | Formatting writes and lint autofixes                                                      |
| `vp check --no-fmt`, `--no-lint`                     | Skip corresponding static step; enabled type checking can still run                       |
| `vp test`, `vp test watch`, `vp test run --coverage` | Built-in Vitest; one-shot by default, explicit watch                                      |
| `vp build`                                           | Built-in Vite application production build, not this package's arbitrary build script     |
| `vp pack`                                            | tsdown library packaging; only appropriate if deliberately adopting a new output pipeline |
| `vp run test`, `vp run check`, `vp run schema`       | Execute the named existing script/task                                                    |
| `vp install --frozen-lockfile`                       | Package-manager install using this project's pnpm pin                                     |

Sources: check [4], lint [10], format [11], test [5], build [12], pack [13],
script/task dispatch [14], package management [8].

A suitable script surface for the initial root migration is:

```json
{
  "check": "vp check && vp run test",
  "format": "vp fmt --write .",
  "format:check": "vp fmt --check .",
  "lint": "vp lint .",
  "test": "node --test \"test/*.test.mjs\""
}
```

Keep the other scripts unchanged. **`vp check` and `vp run check` differ**:
only the latter executes the aggregate package script above. Built-in commands
cannot be overridden by defining a same-named script. [14]

## ESLint replacement: preserve policy, not merely the executable

Oxlint is the recommended replacement, not ESLint invoked through a new wrapper.
Its built-in rules and optional JS plugins cover many ESLint setups, but rule
semantics and plugin APIs are not identical. JS plugins are alpha/not covered
by semver in the published Oxlint API. This repo has no third-party ESLint
plugins, so there is no current reason to retain ESLint as a second linter. [10], [15].

The Vite+ migrator runs **`@oxlint/migrate`**, then merges its generated config
into `lint`; it reports skipped rules. It selects a published migrator version
not newer than bundled Oxlint because the migrator can lag Oxlint releases.
It also enables type-aware/type-check defaults unless an unsupported `baseUrl`
configuration prevents that. Non-interactive ESLint migration is accepted by
default. [16]

**Concrete baseline conversion was tested in `/tmp`:** the fixed-baseline
`eslint.config.js`, `@eslint/js@10.0.1`, and the lockfile's `globals@17.12.0` were
made available, then:

```sh
pnpm dlx @oxlint/migrate@1.85.0 --merge --with-nursery --details
```

Result: **62 translated rules**, including explicit error-level `no-undef` and
`no-unused-vars`; the two skipped recommended rules were `no-dupe-args` and
`no-octal`, both reported as superseded by strict mode. The JS/MJS override
became `env: { es2026: true, node: true }`. This is evidence about config
translation, not linting the migrated repository. Source/API: [15], [16].

Important follow-up:

- Do not assume a lone `categories: { correctness: "error" }` is equivalent to
  `@eslint/js` recommended. Review the **translated rule list**, including rules
  outside the default category. The tested converter also enables Oxc,
  TypeScript, and Unicorn plugins with correctness warnings; these are an
  **additional** policy, not preservation of the old ESLint preset. [15]
- Preserve Node globals, `no-undef`, and error severities. Default lint warnings
  need not fail CI: use explicit error rules/categories or `--deny-warnings`
  if the agreed policy is zero warnings. Do not hide missing policy with
  `--quiet`. [10], [15].
- Oxlint can discover more file types than baseline ESLint. Decide whether to
  retain JS/MJS scope, expand into TS/templates, or ignore data-only trees;
  inspect file discovery with `vp lint --debug=files`. [15]
- For this plain JS/MJS package with no root tsconfig, type-aware/type-check
  enablement is **not** a demonstrated replacement for any existing check.
  Leave it off initially unless introducing and validating an intentional JS
  or TS project configuration. In particular, do not accidentally adopt the
  tsconfigs inside template/fixture data. [4], [10].
- Remove `globals` manually after confirming it is no longer referenced; the
  inspected migrator's ESLint dependency cleanup does not list `globals`.
  Translate any suppression comments and review unsupported ones. [16]

## Prettier replacement: exclusions and exact bytes matter

The docs recommend Oxfmt and root `fmt`. The bundled **0.70.0** package schema
says most options match Prettier, **not all**. Its `printWidth` default is 100,
import sorting is disabled by default, and **package.json sorting is enabled
by default**. Thus “Prettier compatible” does not justify promising byte-for-byte
unchanged output. Explicitly set `sortPackageJson: false` for initial parity;
keep import sorting disabled unless intentionally adopting a new style. [11], [17].

**Concrete baseline formatter migration was tested in `/tmp`:**

```sh
pnpm dlx --package=vite-plus@1.0.0 vp fmt --migrate=prettier
```

It generated a `fmt` block with `printWidth: 100`, `sortPackageJson: false`, and
these `ignorePatterns`: `.agents/`, `schema/`, `blueprint/templates/`,
`test/fixtures/lombardi/`. The migrator can also retain `.prettierignore` while
warning that `ignorePatterns` is preferred. The verified formatter CLI uses
`.gitignore` and `.prettierignore` by default when no `--ignore-path` is given.
After consolidating exclusions, remove old Prettier files/dependency only when
the intended file set and resulting diff are verified. [16], [17].

Do not enable import sorting, package-key sorting, Tailwind sorting, or extra
format transformations as incidental migration cleanup. General Prettier plugin
compatibility must be audited separately if plugins are added later; this root
has none. Review formatting diffs, especially Markdown/YAML, and retain the
byte-preservation boundaries above. The schema also marks `endOfLine: "auto"`
unsupported; it is not used by this repository. [17]

## Tests, build, and other replaceable tooling

**Keep Node tests for the first tooling change.** All 30 root test files register
through `node:test`; some use `t.after`, and `test/support/fixture-site.mjs` uses
Node's `after`. `vp test` runs Vitest, not that API or the package test script.
A future migration must change registration imports to `vite-plus/test` and
port cleanup context/hooks deliberately (`onTestFinished`, `afterEach`, or
`afterAll` as appropriate). Existing `node:assert/strict` assertions need not
be mechanically rewritten just to register tests with the new runner. [5], [18].

For any deliberate Vitest adoption, start with:

```ts
// Only after converting the runner APIs, not for the initial Node-test phase.
test: {
  include: ["test/*.test.mjs"],
},
```

Vitest's broad default discovery would additionally collect test files shipped
inside `blueprint/templates/` and `test/fixtures/lombardi/`. Preserve discovery,
cleanup, subprocess/environment behavior, assertions, and executed test counts;
“passes” with fewer/no registered tests is not migration success. Vitest 5
compatibility defaults concern an existing Vitest 4 suite, **not** automatic
conversion of Node's test runner. [5], [18].

Vite+ can additionally replace standalone Vite/Rolldown, Vitest, tsdown/tsup,
Oxlint/Oxfmt, task runners, `lint-staged`, and some runtime/package-manager
management workflows. They are mostly **absent from this root**. `vp run` has
optional caching (package scripts are uncached by default); never cache
publishing/provisioning/secrets operations as a side effect of consolidation.
Hooks/staged checks can be adopted later; existing Husky/lefthook/etc. policies
are not automatically converted. [2], [3], [14].

Do not run `vp build` against this root's lack of application entrypoint or
`vp pack` against an unconfigured library and treat failure as proof that
lint/format adoption failed. New bundling would require reviewing `bin`,
`exports`, file assets, consumer imports, release behavior, and package contents.
The generic upstream validate-build advice only applies to a configured output
pipeline. [12], [13].

## CI: exact action version and no duplicate install

The official latest setup action was **v1.21.1**, tag commit
**`3754dd7dbdb32bd8f6d28b6043de13ad3a75f21f`**. Use the exact version/SHA, not
`@v1`: the official guide says that tag no longer receives updates. [19], [20].

Applicable GitHub Actions steps (retain the surrounding workflow/events/permissions):

```yaml
- uses: actions/checkout@v4
- uses: voidzero-dev/setup-vp@3754dd7dbdb32bd8f6d28b6043de13ad3a75f21f # v1.21.1
  with:
    version: "1.0.0"
    node-version: "24.21.0"
    cache: true
    run-install: false
- run: vp install --frozen-lockfile
- run: vp run check
```

This can replace separate `pnpm/action-setup` and `actions/setup-node` steps;
keeping those and using local `pnpm exec vp` is also valid. Upgrade the old
22.12.0 pin either way. The action's **`run-install` defaults to true** and
**`cache` to false**: the live CI guide's setup-then-install example otherwise
installs twice. Its `package-manager` input selects management mode, **not** a
version string; this repository's `packageManager` supplies pnpm 12.6.0. The
action itself uses `node24` to bootstrap, independently of the chosen project
runtime. [19], [20].

Cache covers package-manager data, not Vite Task results. An alternative is to
let the action install with explicit frozen-lockfile arguments and omit the
separate install step. Avoid an unpinned fallback to latest; the `version`
input makes the example independent of automatic manifest detection. [19], [20].

## Implementation/validation checklist and limits

1. Select a supported contributor/CI runtime; retain or intentionally revise
   the separate consumer engine contract.
2. Add exact local Vite+ and aligned pnpm overrides; do not make template/data
   directories workspace members. Refresh the root lockfile with pnpm 12.6.0.
3. Translate lint policy, Node globals, and file scope; consolidate formatter
   options/exclusions and disable new sorting. Remove obsolete deps/configs.
4. Keep the Node test script and the aggregate test-inclusive `check`.
5. Update CI with a supported runtime and one frozen install.
6. Verify `pnpm exec vp toolchain`, `pnpm format:check`, `pnpm lint`, `pnpm test`,
   and `pnpm check`; repeat `pnpm install --frozen-lockfile` on a clean checkout.
   Review `git diff`, absence of byte-preserved template/fixture changes, and
   published package contents. Only run build/pack if intentionally configured.

Research verification covered primary documentation/source inspection, published
metadata, actual CLI help/toolchain, and baseline ESLint/Prettier config conversion
in disposable directories. **It did not run the automatic migration in this
repository, prove lint-rule equivalence, execute a Vitest-converted suite, test
a generated site's upgrade, or execute the proposed GitHub Actions workflow.**
Full compatibility and formatting-output parity remain implementation gates.

For this note, the concurrently updated worktree passed `pnpm format:check`,
`pnpm lint`, and `pnpm check` (333 Node tests passed, none skipped). That is
validation of the document/current worktree, not an isolated migration comparison.

## Primary sources

All external evidence below is first-party documentation, official source, or
publisher package APIs/artifacts; no secondary tutorials were used.

[1]: https://registry.npmjs.org/vite-plus/1.0.0
[2]: https://viteplus.dev/guide/local-cli
[3]: https://viteplus.dev/guide/migrate
[4]: https://viteplus.dev/guide/check
[5]: https://viteplus.dev/guide/vitest-v5
[6]: https://viteplus.dev/guide/migrate-rules
[7]: https://viteplus.dev/guide/global-cli
[8]: https://viteplus.dev/guide/install
[9]: https://viteplus.dev/config
[10]: https://viteplus.dev/guide/lint
[11]: https://viteplus.dev/guide/fmt
[12]: https://viteplus.dev/guide/build
[13]: https://viteplus.dev/guide/pack
[14]: https://viteplus.dev/guide/run
[15]: https://github.com/oxc-project/oxlint-migrate
[16]: https://github.com/voidzero-dev/vite-plus/tree/e35a2dabe5a95da98ed045533737c104303e3fda/packages/cli/src/migration/migrator
[17]: https://registry.npmjs.org/oxfmt/0.70.0
[18]: https://github.com/vitest-dev/vitest/tree/v5.0.1/packages/vitest/src/runtime/runner
[19]: https://viteplus.dev/guide/ci
[20]: https://github.com/voidzero-dev/setup-vp/blob/v1.21.1/action.yml

- **[1]** [npm latest](https://registry.npmjs.org/vite-plus/latest), exact release
  metadata above, and [published artifact](https://registry.npmjs.org/vite-plus/-/vite-plus-1.0.0.tgz).
- **[5]** Also [test command guide](https://viteplus.dev/guide/test).
- **[9]** Also [lint config](https://viteplus.dev/config/lint),
  [format config](https://viteplus.dev/config/fmt), and
  [check config](https://viteplus.dev/config/check).
- **[15]** Official migrator README/API; the exercised version is available at
  [1.85.0](https://registry.npmjs.org/@oxlint%2Fmigrate/1.85.0).
  Bundled [Oxlint 1.85.0](https://registry.npmjs.org/oxlint/1.85.0) artifact
  `dist/index.d.ts` and `configuration_schema.json` supply config/rule API evidence.
- **[16]** Inspected source SHA is pinned above, specifically `eslint.ts`,
  `prettier.ts`, and `vite-config.ts`; source may advance independently of releases.
  Published 1.0.0 CLI/config-conversion execution provides the release-specific
  verification described here, rather than assuming current source equals it.
- **[17]** Inspected exact-version Oxfmt artifact `configuration_schema.json`
  and `dist/index.d.ts`; metadata links its
  [official source repository](https://github.com/oxc-project/oxc).
- **[18]** Runner collection/context API plus
  [Vitest 5.0.1 defaults](https://github.com/vitest-dev/vitest/blob/v5.0.1/packages/vitest/src/defaults.ts).
- **[20]** [Exact action release](https://github.com/voidzero-dev/setup-vp/releases/tag/v1.21.1),
  [official releases API](https://api.github.com/repos/voidzero-dev/setup-vp/releases/latest),
  and [tags API](https://api.github.com/repos/voidzero-dev/setup-vp/tags?per_page=8).
