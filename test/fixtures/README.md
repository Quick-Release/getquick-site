# Test fixtures

These files are historical baseline evidence, not current site configuration.
Do not regenerate expected fixtures from the production implementation. Shared
test recipes belong in [`test/support/`](../support/), not here.

## Provenance and use

| Fixture                                                | Origin                                                                                                                                                                | Used by                                                                                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lombardi/`                                            | Sixteen CI Worker, Frontend deploy and release-step files extracted from [Lombardi at `b2061a9`][lombardi-baseline] in [gq-site commit `3f4ce39`][deploy-extraction]. | [`sync/deploy-files.test.mjs`](../sync/deploy-files.test.mjs) compares rendered files and lock hashes with this baseline.                           |
| `manifests/lombardi.v0.json`, `manifests/ekis.v0.json` | The sites' unversioned `gq.ops.json` inputs, captured in [gq-site commit `0730d49`][v0-extraction].                                                                   | [`manifest/schema-and-migrations.test.mjs`](../manifest/schema-and-migrations.test.mjs) checks migration, dropped legacy keys and command refusals. |
| `manifests/lombardi.shop-devtools.config.mjs`          | Lombardi's legacy release configuration as used with `@getquick/site` 0.8.0, captured in [gq-site commit `348a73a`][legacy-extraction].                               | The same migration suite checks folding site additions into the manifest while preserving release, verify and doctor behavior.                      |
| `manifests/lombardi.v1.json`                           | The populated schema-v1 generation input introduced in [gq-site commit `3f4ce39`][deploy-extraction], including plugins and site-specific release additions.          | The deploy-file suite renders Lombardi's wiring from its manifest values.                                                                           |

The `v0` and `v1` suffixes identify manifest schema versions, not package
versions. Site identifiers and domains are historical inputs; the package tests
need no network, credentials or provider accounts.

### Recorded correction

The Lombardi deployment baseline is not an untouched upstream copy in every
respect. [gq-site commit `86e701f`][git-isolation-fix] deliberately updated
`lombardi/scripts/ci.test.mjs` alongside the blueprint source to strip inherited
`GIT_*` variables before running Git in throwaway repositories. This prevents a
site's Git hook from making the extracted test modify the caller's repository.
The deploy-file suite retains regression coverage for that isolation.

## Preservation

- Preserve fixture paths, contents and version identifiers during organization,
  naming and formatting changes. Do not replace historical inputs with today's
  site configuration or rewrite expected files from rendered blueprint output.
- `vite.config.ts` excludes `test/fixtures/lombardi/**` from formatting and
  linting. Its files retain their own extracted toolchain pins; they do not
  follow this package's source-file conventions.
- If a baseline must change, make it an explicit behavioral change: record the
  origin and reason, and review the corresponding assertions. The correction
  above is an example, not permission to silently refresh snapshots.

## Discovery

`pnpm test` selects root suites and one level of explicitly named module folders.
It intentionally excludes `test/fixtures/` and `test/support/`. Do not replace
that allowlist with recursive discovery through `test/`.

In particular, `lombardi/scripts/ci.test.mjs` is an extracted site test script,
not a package suite. The deploy-file suite controls when its generated copy runs
in a temporary site. New fixture files must not become independently discovered
package tests.

For helper roles and targeted test commands, see
[the development guide](../../docs/development.md#tests).

[lombardi-baseline]: https://github.com/Quick-Release/lombardi/tree/b2061a9
[deploy-extraction]: https://github.com/Quick-Release/gq-site/commit/3f4ce39
[v0-extraction]: https://github.com/Quick-Release/gq-site/commit/0730d49
[legacy-extraction]: https://github.com/Quick-Release/gq-site/commit/348a73a
[git-isolation-fix]: https://github.com/Quick-Release/gq-site/commit/86e701f
