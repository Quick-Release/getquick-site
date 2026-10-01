# {{Project}} Frontend

Astro, server-rendered on Cloudflare Workers, reading published content from
the CMS (`../cms`) through WPGraphQL. Its Worker is declared in
`../../infra/frontend.run.ts` and deployed by Alchemy, not Wrangler.

## Development

From the workspace root:

```sh
pnpm install
cp apps/frontend/.env.example apps/frontend/.env   # or: pnpm setup
pnpm dev
```

`PUBLIC_WORDPRESS_GRAPHQL_URL` in `.env` points at the CMS's GraphQL endpoint
(`https://{{project}}-admin.ddev.site/wp/graphql` with `pnpm cms:dev`). With no
CMS running, the pages render an empty state, so the Frontend can be built
before the CMS exists.

## Blocks

`src/lib/wp-block-renderer.ts` renders the GETQUICK Design blocks WPGraphQL
Blocks returns (the Video Hero; containers through `wp-container-layout.ts`),
and `wp-block-styles.ts` turns the CMS's spacing and color presets into the
CSS saved block classes need. It is the site's own copy of the renderer, so
change it here; a shared renderer package is planned.

## Checks

`pnpm check` (`astro check`), `pnpm lint` (`vp lint`) and `pnpm test`
(`vp test`) run from the workspace root, and in `pnpm verify`.

## Deploys

Releases deploy the Frontend from the `v*` tag in Cloudflare CI
(`infra/ci`). Deploys build with `PUBLIC_WORDPRESS_GRAPHQL_URL` set to
`https://<domains.admin>/wp/graphql` from `gq.ops.json`; `pnpm deploy:frontend`
redeploys by hand with the token in Sigillo `staging`.
