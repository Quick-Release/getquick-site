# getquick-site

Shared tooling for GETQUICK sites, published to public npm as
[`@getquick/site`](https://www.npmjs.com/package/@getquick/site): one `gq`
CLI, configured by each site's own `gq.ops.json`.

It replaces [`gq-ops`](https://github.com/Quick-Release/gq-ops) and the
vendored `shop-devtools`. The package is being extracted from the Lombardi
site (phase 1 of the GETQUICK blueprint rollout); release and version sync,
Ploi provisioning and releases, database sync and backups, Cloudflare CI and
media, Sigillo secret injection, and the `setup`/`doctor`/`verify` runners
move in over the coming releases. Today it carries `gq-ops`'s commands (Ploi,
Cloudflare, and GitHub Actions sync) and `shop-devtools`'s release and version
commands.

## Install

Pin an exact version in the site's root `devDependencies`; it needs no
registry login:

```sh
pnpm add --save-dev --save-exact @getquick/site
```

```json
{
  "scripts": {
    "ops": "gq"
  }
}
```

## Configure a site

`gq` walks up from the current directory to the nearest `gq.ops.json`,
stopping at the enclosing Git repository, and treats that directory as the
site root. Every site-relative path resolves from there. `--project <dir>` or
`--config <file>` selects a site explicitly.

```json
{
  "project": "example-site",
  "ploi": { "serverId": "12345", "siteId": "67890" },
  "cloudflare": {
    "accountId": "0123456789abcdef0123456789abcdef",
    "zoneId": "abcdef0123456789abcdef0123456789",
    "zoneName": "example.com"
  },
  "github": {
    "repository": "Quick-Release/example-site",
    "environment": "production",
    "secrets": ["CLOUDFLARE_API_TOKEN"],
    "variables": ["CLOUDFLARE_ACCOUNT_ID"]
  }
}
```

Provider IDs are safe to commit; tokens are not. `gq` reads `PLOI_API_TOKEN`,
`CLOUDFLARE_API_TOKEN` and optional ID overrides (`PLOI_SERVER_ID`,
`PLOI_SITE_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`,
`CLOUDFLARE_ZONE_NAME`) from, in increasing precedence:

1. `${XDG_CONFIG_HOME:-$HOME/.config}/gq/ops.env`
2. the site's `.env`
3. the process environment, which is where a secret manager such as Sigillo
   injects them per command
4. flags (`--server`, `--site`, `--account`, `--zone`)

## Commands

```sh
gq --version
gq context show [--json]

gq ploi servers list
gq ploi server show [--server <id>]
gq ploi sites list [--server <id>]
gq ploi site show [--server <id>] [--site <id>]
gq ploi api list [--group <group>] [--search <text>]
gq ploi api describe <operation-id>
gq ploi api <operation-id> [--path name=value] [--query name=value]
    [--page <n>] [--per-page <n>] [--data <json> | --data-file <file>]
    [--all] [--max-pages <n>] [--dry-run | --yes]

gq cloudflare accounts list
gq cloudflare zones list [--account <id>]
gq cloudflare zone show [--zone <id>]
gq cloudflare dns list [--zone <id>] [--name <hostname>] [--type <type>]

gq github actions sync [--dry-run] [--yes]

gq version check [version]
gq version sync [version]
gq release prepare [version]
gq release tag [version]
gq release push <major|minor|fix> [--no-deploy]
```

`--json` prints machine-readable output; `ploi api` always prints the
provider's JSON. In a terminal, `gq` with no arguments opens a command picker.

`ploi api` covers all 225 operations in the Ploi API reference
([inventory](docs/research/ploi-api.md)); operation IDs follow the docs' routes,
such as `sites.log-site`. Every non-GET operation needs `--yes` (or a prompt in
a terminal); `--dry-run` prints the resolved request without sending it.
Cloudflare commands are read-only. `github actions sync` pipes each value to
`gh` on stdin and never prints it.

## Release and version commands

The release commands read the site's own release config,
`shop-devtools.config.mjs` in the site root (the name carries over from the
tool they replace). Every path in it is relative to the site root:

```js
export default {
  versionFile: "VERSION", // the site's version; the default
  changelogPath: "CHANGELOG.md", // the default
  jsonFiles: ["package.json"], // files whose `version` field follows VERSION
  textFiles: [
    {
      path: "web/app/themes/example-theme/style.css",
      patterns: [{ regexp: /^Version: .+$/m, replacement: (version) => `Version: ${version}` }],
    },
  ],
  // Optional: Composer packages pinned to the release version.
  composer: { manifest, lock, workingDir, packages: [], disableNetwork },
  releasePaths: ["VERSION", "CHANGELOG.md", "package.json"], // what a release commits
  checks: [{ cmd: "pnpm", args: ["run", "check"] }], // run before a release commits
  deploys: [], // run after it pushes, unless --no-deploy
};
```

- `version check` fails, listing each file, when any of them (and the
  Composer lock) doesn't carry `VERSION` or the given version.
- `version sync` writes `VERSION` (or the given version) into every file.
- `release prepare` also writes the version to the version file first.
- `release tag` checks the version and a clean tree, then creates an
  annotated `v<version>` tag.
- `release push` bumps the version (`fix` and `patch` bump the third number),
  syncs it, adds the commits since the last `v*` tag to the changelog, runs
  `checks`, commits `releasePaths`, tags, pushes the branch and the tag, and
  runs `deploys`. Command output streams through as it runs.

## Programmatic use

The CLI is a thin shell over `run()`, which resolves to an exit code:

```js
import { run } from "@getquick/site";

const code = await run(["ploi", "site", "show", "--json"], {
  cwd, // where discovery starts
  env, // replaces process.env
  fetch, // every provider request
  exec, // every child process: (command, args, { cwd, env, input, stdout, stderr }) => { code, stdout, stderr }
  stdout, // anything with write()
  stderr,
});
```

No command reads `process.env` or `process.cwd()`; `bin/gq.mjs` is the only
place that passes the real ones.

## Development

```sh
pnpm install
pnpm check   # Prettier, ESLint, node:test
```

Tests call `run()` against a fixture site (a temporary Git repository with a
`gq.ops.json`) with recording fakes for `fetch` and `exec`
([`test/support/fixture-site.mjs`](test/support/fixture-site.mjs)). They need
no network, credentials, or provider accounts.

## Releasing

1. Bump `version` in `package.json`, add its section to `CHANGELOG.md`, and
   commit.
2. Tag the commit `v<version>` and push the commit and tag.
3. `pnpm release:publish` checks that `HEAD` carries that tag and that
   `pnpm check` passes, then runs `npm publish` under Sigillo's `operations`
   environment (`gq.ops.json`), where `NPM_TOKEN` lives. The token is never
   written to disk. It is a granular token that expires within 90 days, so
   rotate it before then.

## License

[MIT](LICENSE)
