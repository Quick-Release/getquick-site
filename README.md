# getquick-site

Shared tooling for GETQUICK sites, published to public npm as
`@getquick/site`: one `gq` CLI for releases and version sync, Ploi
provisioning and releases, database sync and backups, Cloudflare CI and
media, Sigillo secret injection, and the `setup`/`doctor`/`verify` runners.
Each site configures it through its own `gq.ops.json`.

It replaces [`gq-ops`](https://github.com/Quick-Release/gq-ops) and the
vendored `shop-devtools`. The package is being extracted from the Lombardi
site (phase 1 of the GETQUICK blueprint rollout) and isn't published yet.

## License

[MIT](LICENSE)
