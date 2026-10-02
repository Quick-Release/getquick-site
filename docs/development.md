# Develop and publish gq-site

[Documentation](README.md)

## Development

Use Node 24.21.0 (the CI version) and the pnpm version pinned in `package.json`.
The published CLI still supports Node 22.12.0+; Vite+ 1.0's development tooling
requires Node `^22.18.0 || ^24.11.0 || >=26.0.0`.

```sh
pnpm install --frozen-lockfile
pnpm exec vp run check   # Vite+ formatting/linting, then node:test
pnpm exec vp run format  # format with Vite+ (Oxfmt)
pnpm exec vp run lint    # lint with Vite+ (Oxlint)
pnpm schema             # regenerate schema/gq.ops.schema.json after changing src/manifest/schema.mjs
```

The existing `pnpm check`, `pnpm format`, `pnpm format:check`, `pnpm lint`
and `pnpm test` scripts remain available. Formatting and linting are configured
in `vite.config.ts`; generated schema, upstream skills, and extracted blueprint
and Lombardi fixtures are excluded from formatting. The extracted templates keep
their own toolchain pins. See [the migration research](https://github.com/Quick-Release/gq-site/blob/main/docs/research/vite-plus-tooling-migration.md).

`vp check` runs static checks only; `vp run check` also runs the tests.
`vp run test` uses the existing `node:test` suite, not `vp test` (Vitest).

Keep tests flat in `test/`, named `<module>-<subject>.test.mjs` (for example,
`workspace-verify.test.mjs` or `sync-ownership.test.mjs`); a module-only name is
fine for a whole-module suite. Shared helpers live in `test/support/` and baseline
evidence in `test/fixtures/`. Test discovery selects only `test/*.test.mjs`, not
the extracted test scripts inside fixtures.

Tests call `run()` against a fixture site (a temporary Git repository with a
`gq.ops.json`) with recording fakes for `fetch` and `exec`
([`test/support/fixture-site.mjs`](https://github.com/Quick-Release/gq-site/blob/main/test/support/fixture-site.mjs)). They need
no network, credentials, or provider accounts.

For blueprint source roles, ownership mappings, and deliberate dotless source
names, see the [blueprint map](../blueprint/README.md). `ownership.json` remains
the authority for which site paths are touched.

## Releasing

1. Bump `version` in `package.json`, add its section to `CHANGELOG.md`, and
   commit.
2. Tag the commit `v<version>` and push the commit and tag.
3. `pnpm release:publish` checks that `HEAD` carries that tag and that
   `pnpm check` passes, then runs `npm publish` under Sigillo's `operations`
   environment (`gq.ops.json`), where `NPM_TOKEN` lives. The token is never
   written to disk. It is a granular token that expires within 90 days, so
   rotate it before then.

The [`run()` interface and injected adapters](reference/programmatic-use.md)
are the seam used by the fixture-site tests. For working on a generated site
rather than this package, see [Local site development](guides/local-development.md).
