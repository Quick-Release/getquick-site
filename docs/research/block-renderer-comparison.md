# Block renderers: Lombardi (Astro) vs Ekis (TanStack)

Research for [#20](https://github.com/Quick-Release/getquick-site/issues/20),
input to the [shared block renderer (#8)](https://github.com/Quick-Release/getquick-site/issues/8)
API decision in [#32](https://github.com/Quick-Release/getquick-site/issues/32).
Researched on 2026-10-02. This note records facts and options only; it makes no
decision for #32.

## Commits inspected

| Source | Ref | Commit |
| --- | --- | --- |
| Lombardi (`Quick-Release/lombardi`) | `origin/main` (v0.10.0) | [`2c32080`](https://github.com/Quick-Release/lombardi/tree/2c32080ea1478f2e7e393e79f439b2d33748fd9d) |
| `gq new` skeleton (`getquick-site`) | `origin/main` | [`45d372d`](https://github.com/Quick-Release/getquick-site/tree/45d372d/blueprint/templates/apps/frontend) |
| Ekis (`Quick-Release/ekis`) | `origin/main` (local checkout was on `chore/blueprint-adr-review`) | [`ce258d8`](https://github.com/Quick-Release/ekis/tree/ce258d86b7a9cb9b55e9d362e55a038162ce2316) |
| Ekis ADR 0008 (blueprint) | `origin/chore/blueprint-adr-review`, not on `main` | `220e0eb` |
| `getquick-design` plugin (`Quick-Release/getquick-design`) | `origin/main` (latest tag v0.2.20) | [`bfbbbf2`](https://github.com/Quick-Release/getquick-design/tree/bfbbbf22c8245fb80953e7ebc653e79960f6fa3d) |

Paths below are relative to each repository at those commits. Lombardi's
renderer lives in `apps/frontend/src/lib/`. Ekis's lives in
`packages/getquick-design-contract`, `packages/getquick-design-renderer-core`
and `apps/frontend/src/design/`.

## Summary

The two stacks share a CMS plugin (`getquick-design`) and a set of WordPress
block names. They share almost no code, data shape or rendering model.

- **Lombardi** renders WordPress's own HTML. It fetches over WPGraphQL, mostly
  injects the post's server-rendered `content`, and walks the block tree only to
  fix up two GETQUICK blocks (video hero, container layout). The output is an
  HTML string.
- **Ekis** never uses WordPress's rendered HTML. It fetches a normalized,
  framework-neutral node tree over REST (`getquick-design/v1` and the
  `getquickBlocks` field) that is defined by a JSON Schema/OpenAPI contract. A
  per-framework adapter registry maps each block name to a React component.

A shared package can't simply merge the two. Each consumer would have to change
its model, or the package would hold two renderers behind one name. The options
are at the end.

## Side by side

| Concern | Lombardi / skeleton (Astro, content) | Ekis (TanStack Start, commerce) |
| --- | --- | --- |
| Data client | WPGraphQL `POST /wp/graphql` (`wordpress.ts`), needs `wp-graphql` and `wpgraphql-blocks` | REST: `wp-json/getquick-design/v1` (`design/api.ts`), `wp-json/wp/v2` and `wp-json/wc/store/v1` (`lib/api.ts`). `wp-graphql` is installed but the frontend never queries it |
| Block payload | `blocks(attributes, htmlContent, dynamicContent)` from WPGraphQL Blocks: raw attributes plus **rendered** HTML per block | `DesignNode` (`node.schema.json`): `name`, allowlisted `attributes`, `content` (kses'd **saved** `innerHTML`, leaf nodes only), `children`, `tokens`, `dataRequirements`, `supported` |
| What a page renders | The WP-rendered `content` string. Blocks are rendered only when the page contains a video hero (`getEntryByUri`) | Always the node tree: a template layout (`/layouts/single-post`) with the page's `getquickBlocks` appended to the `content` region (`design/content-blocks.ts`) |
| Unit of layout | The entry. Header/footer come from site chrome (menus) plus, in Lombardi only, `designPattern` HTML over GraphQL | `DesignLayout`: exactly three regions (header, content, footer), each a template part with logical IDs (`template:*`, `part:*`) |
| Renderer output | HTML string (`renderWordPressBlocks(): string`), injected with `set:html` | Generic `Output` (`RendererAdapter<Output, Context>`). Ekis instantiates it with `ReactNode` |
| Block dispatch | Hardcoded `if` on block name inside `renderBlock` | Registry `Record<blockName, NodeRenderer>` plus required `unknownNode`, `region`, `layout` |
| Unknown blocks | Pass WordPress HTML through as-is | `UnknownNode`: text-only (`contractText`) plus children, reported through `onIssue` |
| Styles / tokens | `blockPresetStyles()` turns the `designTokens` GraphQL field (colors, spacing sizes) into `--wp--preset--*` variables and `.has-*-color` rules | `resolveDesignToken()` maps `var:preset\|…` to `var(--wp--preset--…)` and dotted names to `var(--gqd-…)`, and `tokenStyles()` maps ten `style.*` paths to inline styles. Nothing defines the `--wp--preset--*` values: the contract carries token references, not palette values |
| Container layout | `wp-container-layout.ts` turns `getquick-design/container` `layout`/`blockGap` into `gqd-container-layout` classes and `--gqd-layout-*` variables, and restores parent variables on nested containers | None. No `getquick-design/container` renderer. `core/group` ignores `layout` and applies fixed Tailwind (`mx-auto max-w-7xl px-6`) |
| Site-specific blocks | `lombardi/opening-details` in the shared file (prefers `dynamicContent`, with an attribute fallback). Not in the skeleton | Woo blocks come from `getquick-ecommerce`'s `BlockDefinitions`. A site block would be added to the registry and the manifest (see the customizer below) |
| Commerce/route data | n/a | `RendererEnvironment.data`, keyed by `dataRequirements` (`site`, `post`, `product`, `productCollection(s)`, `cart`, `checkout`, `navigation`), fetched by route loaders. Never in the cached layout ([ADR 0004](https://github.com/Quick-Release/ekis/blob/ce258d86b7a9cb9b55e9d362e55a038162ce2316/docs/adr/0004-public-layout-caching.md)) |
| Language/direction | None (`formatDate` locale only) | `layout.language.resolved`/`direction`, Polylang, `Link` header alternates |
| Safety | `escapeAttribute`, `safeMediaUrl`, YouTube ID allowlist, slug regex for presets. WordPress HTML otherwise trusted | Schema validation, `assertDesignLayout` (structure, version, limits), `resolveLink` policy, text-only content, error boundary |
| Contract/versioning | Implicit: the WPGraphQL schema plus plugin field names. No version check | `contractVersion: "1.0.0"`, `schemaVersion: 1`, `compatibility.json`, `GET /manifest` capability handshake |
| Fixtures/tests | Vitest unit tests on HTML strings (`wp-block-renderer.test.ts`, `wp-container-layout.test.ts`, `wp-block-styles.test.ts`, `wordpress.test.ts`) | `fixtures/blocks/tanstack.json` (37 nodes), plus layout, manifest, preview and product fixtures validated by Ajv. The frontend test asserts that registry keys equal fixture names, that `validateManifestAdapter` passes, and that each fixture renders with no axe violations |
| Packaging | Copied into each site (`apps/frontend/src/lib`) | `@getquick/design-contract` 0.1.3 and `@getquick/design-renderer-core` 0.5.0: private workspace packages (`workspace:*`), not published |

## Shared surface

What the two actually have in common today:

1. **The CMS plugin.** Both install `getquick/getquick-design` from the
   Composer registry. Lombardi pins `^0.2.18` (locked 0.2.18) and Ekis pins
   `^0.2.7` (locked 0.2.8). The plugin serves **both** delivery surfaces:
   - GraphQL: `designTokens` (`src/GraphQL/DesignTokens.php`, since ~v0.2.1)
     and `designPattern`/element lists (`src/GraphQL/Elements.php`, since
     ~v0.2.6). Only Lombardi consumes these.
   - REST: `getquick-design/v1` `layouts/{template}`, `manifest`, `discovery`,
     `previews` (`src/Rest/*Controller.php`) and the `getquickBlocks` field on
     posts and pages (`src/Rest/ContentBlocksField.php`, since v0.2.0). Only
     Ekis consumes these.

   The plugin already hardcodes contract `1.0.0` in its REST controllers and
   `TemplateResolver`, so it is the producer side of Ekis's contract.
2. **Block names.** `core/*` and `getquick-design/*` blocks are authored in
   the same editor. The plugin's `BlockRegistry::all()` is the manifest: the
   allowed blocks per region, with attribute allowlists, token supports and a
   `renderer_fixture` name. At `bfbbbf2` it includes `getquick-design/container`
   (fixture `getquick-container`) but not `getquick-design/video-hero`, `grid`,
   `loop` or `social-links`. Those are GETQUICK "Elements" blocks
   (`Elements/BlockCatalog.php`), outside the design manifest.
3. **The `--wp--preset--*` CSS variable convention.** Lombardi defines the
   variables from `designTokens`. Ekis references them from tokens but defines
   none.
4. **Small pure helpers** that both reimplement: safe media URL (http/https
   only), HTML-to-text, and link localisation (Lombardi's `menuItemHref`, Ekis's
   `resolveLink`/`links.ts`).
5. **Stack baseline.** TypeScript, Tailwind 4 and Cloudflare Workers. Lombardi
   uses Astro 7 with `output: "server"`. Ekis uses React 19 and TanStack Start.

What is not shared: the transport (GraphQL vs REST), the block payload
(rendered HTML vs normalized node), the output type, the dispatch mechanism,
the fixture format and the versioning.

## Per-framework seams

Where a shared package would meet each framework:

- **Ekis already has the seam.** `@getquick/design-renderer-core` has no DOM,
  React or WordPress dependency (README). `renderDesignLayout(layout, adapter,
  env)` is generic over `Output` and `Context`. The adapter contract
  (`ADAPTER_GUIDE.md`) puts in the adapter: the node registry plus
  `unknownNode`, `region`, `layout`, data providers, token mapping
  (`resolveToken`), link policy (`resolveLink`), language/direction, and error
  presentation. The guide's minimal example is a non-React adapter returning
  plain objects. A server-template (Astro) adapter fits the declared seam
  (`Output = string`) and does not exist yet.
- **Lombardi has no seam.** Framework coupling is thin: the renderer returns a
  string and Astro injects it with `set:html` (`[...slug].astro`, `index.astro`).
  Its "adapter" is the whole of `wp-block-renderer.ts`. Lombardi's real
  coupling is to WordPress's rendered HTML and WPGraphQL Blocks, not to Astro.
- **The data seam differs in kind.** Ekis separates layout (public, cacheable)
  from route data (loaders, `RendererEnvironment.data`). Lombardi's entry query
  returns content, blocks and tokens together, and `getEntryByUri` retries
  without blocks on a 5xx (a WPGraphQL Blocks failure mode seen on the Team
  page in production, per the code comment).

## Key divergences

1. **Rendered HTML vs normalized nodes.** This is the root difference.
   Lombardi trusts and reuses WordPress's PHP rendering (`htmlContent`,
   `dynamicContent`, `content`), so every core block and plugin block works
   with no frontend code. Ekis's [ADR 0002](https://github.com/Quick-Release/ekis/blob/ce258d86b7a9cb9b55e9d362e55a038162ce2316/docs/adr/0002-framework-neutral-contract.md)
   forbids rendered frontend HTML in the contract and requires "every enabled
   block needs a renderer in every production adapter". Under Ekis's model,
   Lombardi would need adapter renderers for every block its editors use.
2. **GraphQL vs REST.** These are separate surfaces of the same plugin, not
   alternatives over the same data. GraphQL gives per-block rendered HTML and
   the token palette. REST gives the validated contract tree, template regions,
   the manifest and previews. The GraphQL route needs `wpgraphql-blocks`, which
   Ekis doesn't install.
3. **Container layout and video hero exist only in Lombardi's renderer.** Ekis
   has no renderer for `getquick-design/container`. That block is `enabled` in
   the plugin's manifest since v0.2.7, and Ekis locks 0.2.8. Ekis's CI coverage
   test checks against the contract's fixture manifest (18 blocks), not the live
   one, so a container in Ekis content would reach `UnknownNode` and raise a
   `getquick_renderer_missing_node` issue at runtime. This is inferred from the
   code and not checked against a live site. `getquick-design/video-hero` is not
   in the manifest, so in `getquickBlocks` it serializes as `supported: false`
   and Ekis renders it as unknown.
4. **Tokens: values vs references.** Lombardi receives the palette and emits
   variables and preset classes. Ekis's contract carries only token references.
   Nothing in the contract or frontend supplies the values, and the Tailwind
   classes in the components set the look. A shared package must say who emits
   the `--wp--preset--*` values on the commerce side.
5. **Contract and fixtures.** Ekis has a versioned contract with fixtures, a
   compatibility matrix, a manifest handshake and an authoring-side guard. The
   plugin's `BlockPolicy` rejects template parts with unsupported blocks, and
   the extension guide says to set `enabled: true` only after every adapter
   passes. Lombardi has unit tests only, and its compatibility with the plugin
   is unchecked. Lombardi and the skeleton have no equivalent of
   `compatibility.json`.
6. **Site-specific blocks.** Lombardi adds `lombardi/opening-details` directly
   into the shared renderer file. This is why the skeleton copy diverges from
   Lombardi only by that block plus Lombardi's content queries
   (projects, team, recent posts, `designPattern`). Ekis's model registers a
   site block through the `getquick_design_block_definitions` filter and an
   extra registry entry.
7. **Scope.** Lombardi's renderer is about 200 lines and renders blocks for
   one page type. Ekis's design layer is about 4,000 lines across the adapter
   and data modules (components 1,164, transactional components 752,
   transactional data 492). It renders whole pages, including cart, checkout
   and product routes.

## Skeleton vs Lombardi

`blueprint/templates/apps/frontend/src/lib` is a faithful copy of Lombardi's
renderer at `2c32080`. `wp-block-styles.ts` and `wp-container-layout.ts` are
identical. `wp-block-renderer.ts` differs only by the `lombardi/opening-details`
renderer. `wordpress.ts` drops Lombardi's projects, team members, recent posts,
page templates and `designPattern` queries, and templates the GraphQL endpoint
with `{{project}}`. The skeleton README already calls it "the site's own copy …
a shared renderer package is planned."

## How the planned customizer block plugs in

From the resolution of [ekis#17 (Customizer 02)](https://github.com/Quick-Release/ekis/issues/17)
(approved 2026-09-29, decision 5): the configurator is "a **dedicated customizer
block**, registered in the design manifest and rendered by its own adapter
renderer". Per-product data comes through a separate commerce loader, never the
public layout, and the generic `WooAddToCartWithOptions` is not changed. Its
code lives in `packages/ekis-customizer` (`./contract`, `./render`) and an Ekis
mu-plugin. Decision 8 relies on Ekis ADR 0002 ("every enabled block has a
renderer in every adapter") and the manifest compatibility check. Placement next
to add-to-cart is left to [Customizer 07 (ekis#22)](https://github.com/Quick-Release/ekis/issues/22).

In renderer-core terms, the customizer needs:

- a block definition added through `getquick_design_block_definitions`, with a
  `dataRequirements` entry. Adding a new data context means extending the enum
  in `node.schema.json`, which is a contract change;
- a contract fixture node and a manifest entry;
- a `NodeRenderer` added to the TanStack registry, wrapping the pure
  `ekis-customizer/render`;
- a route loader that supplies its data through `RendererEnvironment.data`.

Consequence for #8: the shared package needs an **extension point for
site-owned node renderers and data contexts**. The registry must be composable
(`{...sharedNodes, ...siteNodes}`) and the coverage check must count site
blocks. Lombardi's `opening-details` is the content-side case of the same need.
The data-requirement enum is currently closed in the schema.

## Options for #32 (facts, not a recommendation)

- **A. Adopt Ekis's contract and renderer core as the shared package and add an
  Astro/string adapter.** Lombardi would move from GraphQL and rendered HTML to
  REST and nodes, and would need renderers for every block its content uses.
  Container layout would be reimplemented as a node renderer (the variable
  logic in `wp-container-layout.ts` ports over), and video hero would need a
  manifest entry. Matches Ekis ADR 0002 and its ADR 0008 phase 4 plan ("move
  contracts and renderer to their own repositories").
- **B. Extract Lombardi's HTML-string renderer as the shared package** (block
  renderer, block styles, container layout, GraphQL client). Ekis would not
  consume it without abandoning ADR 0002, so it serves only content sites.
  Commerce stays on renderer core.
- **C. Two packages under one contract.** The contract and renderer core are
  shared. "WordPress HTML" helpers (preset styles, container layout, video
  hero, GraphQL client) become a content-side package or adapter. This keeps
  Lombardi's pass-through rendering while both sides converge on block names,
  the manifest and fixtures.
- **Cross-cutting either way:** who emits `--wp--preset--*` values on the
  commerce side; a renderer for `getquick-design/container` in Ekis; whether
  the Elements blocks (video hero, grid, loop, social links) enter the
  manifest; the site-block extension point; checking manifest coverage against
  the live plugin manifest rather than a fixture; and the publish target (the
  packages are `private: true` workspace packages today, and the public/private
  and scope questions are open in Ekis ADR 0008).

## Sources

- Lombardi: `apps/frontend/src/lib/{wp-block-renderer,wp-block-styles,wp-container-layout,wordpress}.ts` and their tests, `apps/frontend/src/pages/[...slug].astro`, `apps/cms/composer.json` and `composer.lock`.
- Skeleton: `blueprint/templates/apps/frontend/` (`src/lib/*`, `src/pages/*`, `README.md`, `package.json`).
- Ekis: `packages/getquick-design-contract/{README.md,package.json,compatibility.json,openapi.json,schemas/node.schema.json,schemas/layout.schema.json,schemas/block-fixtures.schema.json,fixtures/blocks/tanstack.json,fixtures/manifest/default.json}`; `packages/getquick-design-renderer-core/{README.md,ADAPTER_GUIDE.md,package.json,src/{index,types,render}.ts}`; `apps/frontend/src/design/{api.ts,content-blocks.ts,single-post-data.ts,adapter/*}`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/routes/pages.$slug.tsx`, `apps/frontend/tests/design-adapter.test.tsx`; `apps/docs/src/content/docs/design/extensions.mdx`; `docs/adr/0002-framework-neutral-contract.md`; `apps/cms/composer.json` and `composer.lock`.
- `getquick-design`: `README.md`, `src/Blocks/{BlockRegistry,BlockPolicy}.php`, `src/Templates/TemplateSerializer.php`, `src/Rest/{ContentBlocksField,LayoutController}.php`, `src/GraphQL/{DesignTokens,Elements}.php`, `src/Elements/BlockCatalog.php`. File-introduction tags come from `git log --diff-filter=A` and `git describe --contains`.
- Issues: [ekis#17](https://github.com/Quick-Release/ekis/issues/17) resolution comment. Ekis ADR 0008 is at `origin/chore/blueprint-adr-review:docs/adr/0008-getquick-site-blueprint.md`.
