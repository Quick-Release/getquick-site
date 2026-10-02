# Documentation

[Package overview and quick start](../README.md)

## Site guides

| Document                                              | Use it for                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Generate and sync a site](guides/sites.md)           | New content sites, managed-file ownership, locks, sync conflicts and create-once files.                                    |
| [Local site development](guides/local-development.md) | Setup, doctor, verify, DDEV, Composer and a local design-plugin checkout.                                                  |
| [Sigillo secrets](guides/secrets.md)                  | Per-command secret injection and checkout login without downloading environments.                                          |
| [Provisioning and deployment](guides/provisioning.md) | Ploi provisioning/releases/media, database backup and live-to-local sync, Cloudflare tokens/buckets, CI and GitHub wiring. |

## Reference

| Document                                               | Use it for                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [Site manifest and environment](reference/manifest.md) | Site discovery, schema v1, manifest migrations and provider token/ID precedence.       |
| [Commands](reference/commands.md)                      | Command syntax, output and mutation confirmation.                                      |
| [Release and version commands](reference/release.md)   | Variant defaults, release/verify/doctor additions and legacy release-config migration. |
| [Programmatic use](reference/programmatic-use.md)      | The existing `run()` interface and injected adapters.                                  |

## Contributors

[Develop and publish gq-site](development.md) covers the toolchain, checks,
test naming and fixture-site seam, schema generation, and npm publishing.

## Design and records

The glossary, ADRs, plans, research and agent guidance keep their existing
repository homes. These links point to the repository so they also work from
the installed npm package; decisions are linked, not copied into guides.

- [Glossary](https://github.com/Quick-Release/gq-site/blob/main/GLOSSARY.md): domain terminology.
- [ADR 0001: The GETQUICK site blueprint](https://github.com/Quick-Release/gq-site/blob/main/docs/adr/0001-the-getquick-site-blueprint.md): the blueprint decision.
- [ADR 0002: Generate sites from one versioned manifest](https://github.com/Quick-Release/gq-site/blob/main/docs/adr/0002-generate-sites-from-a-versioned-manifest.md): manifest and ownership decisions.
- [Rollout plan and evidence](https://github.com/Quick-Release/gq-site/blob/main/docs/plans/getquick-blueprint-rollout.md): accepted gates, passed phases and adoption checklist.
- [Research](https://github.com/Quick-Release/gq-site/tree/main/docs/research): dated inventories and implementation research.
- [Agent guidance](https://github.com/Quick-Release/gq-site/tree/main/docs/agents): issue tracking, triage and domain-document use.

The [Ploi API endpoint inventory](research/ploi-api.md) remains a
2026-09-18 research snapshot and is included in the package. Its proposed CLI
names and historical source links are not the current CLI contract; use the
[command reference](reference/commands.md) for that.
