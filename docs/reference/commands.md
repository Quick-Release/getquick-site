# Commands

[Documentation](../README.md)

Commands below use the site's installed `gq` binary (for example, via
`pnpm exec gq`). An optional root `package.json` script makes `pnpm ops`
run it:

```json
{
  "scripts": {
    "ops": "gq"
  }
}
```

```sh
gq --version
gq context show [--json]
gq new <dir> --project <name> --variant content
gq sync [--manifest] [--check] [--variant <content|commerce>] [--recreate <path>]...
gq skills update [--check]

gq setup [--no-ddev]
gq doctor
gq verify [--ci]

gq ploi servers list
gq ploi server show [--server <id>]
gq ploi sites list [--server <id>]
gq ploi site show [--server <id>] [--site <id>]
gq ploi api list [--group <group>] [--search <text>]
gq ploi api describe <operation-id>
gq ploi api <operation-id> [--path name=value] [--query name=value]
    [--page <n>] [--per-page <n>] [--data <json> | --data-file <file>]
    [--all] [--max-pages <n>] [--dry-run | --yes]
gq ploi provision [--dry-run | --yes]
gq ploi release [--ref <ref>] [--git-dir <dir>]
gq ploi media [--dry-run]

gq db sync [--yes]
gq db backup

gq cms start [--foreground] [ddev start arguments...]
gq cms status
gq cms stop | describe [ddev arguments...]
gq cms composer install | update | reinstall | test | lint | lint:fix [arguments...]
gq cms design [refresh]

gq cloudflare accounts list
gq cloudflare zones list [--account <id>]
gq cloudflare zone show [--zone <id>]
gq cloudflare dns list [--zone <id>] [--name <hostname>] [--type <type>]
gq cloudflare deploy-token [--dry-run]
gq cloudflare releases [--dry-run]
gq cloudflare media [--dry-run]
gq cloudflare ci [--dry-run]

gq media check [--upload | --local] [--json]
gq frontend refresh [--url <frontend origin>] [--json]

gq ci deploy
gq ci runs
gq github setup [--dry-run]
gq git artifacts setup
gq git artifacts get | store | erase

gq sigillo run <environment> -- <command> [arguments...]
gq sigillo login
gq sigillo setup <environment>
gq sigillo secrets <environment> [arguments...]

gq version check [version]
gq version sync [version]
gq release prepare [version]
gq release tag [version]
gq release push <major|minor|fix>
```

`--json` prints machine-readable output; `ploi api` always prints the
provider's JSON. In a terminal, `gq` with no arguments opens a command picker.

`ploi api` covers all 225 operations in the Ploi API reference
([inventory](../research/ploi-api.md)); operation IDs follow the docs' routes,
such as `sites.log-site`. Every non-GET operation needs `--yes` (or a prompt in
a terminal); `--dry-run` prints the resolved request without sending it.
The `cloudflare accounts|zones|zone|dns` commands are read-only.
`gq skills update` works from any Git repository and is documented in the
[agent skills guide](../guides/skills.md).

See [release and version behavior](release.md), [local development](../guides/local-development.md),
[provisioning](../guides/provisioning.md), and [secret injection](../guides/secrets.md)
for detailed command behavior.
