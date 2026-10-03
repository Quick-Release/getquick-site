# TanStack storefront: an ecommerce Frontend blueprint variation

Researched on 2026-10-03 against repository revision
`41311d122bdbd5c901364493114ba7e82d6faa8b` (`@getquick/site` 0.14.1), live
first-party documentation, official examples, and published package metadata
and source. This is research, not an ADR or an implementation. Local findings
describe this revision; upstream `latest` documentation and `main` examples can
change. [Repository package](../../package.json).

**Settled user constraints (clarified during research):** `storefront` must
remain **backend-agnostic**, and **WordPress + WooCommerce is the first
integration**. These are product constraints, not a provider choice left open
by this note. Checkout/gateway selection, customer authentication and the
particular WooCommerce installation/version remain unresolved.

## Recommendation

**Proposed direction:** build `storefront` with **React + TanStack Start +
TanStack Router + TanStack Query**, using SSR for public catalog pages and a
small server-side commerce boundary for privileged operations. Retain
Cloudflare Workers, pnpm, the site's `apps/frontend` location, and the
blueprint's managed-file/app-skeleton ownership rules. Pilot the existing
Alchemy **`Cloudflare.Website.Vite`** integration before considering a different
deployer. Start supplies the SSR/server-function layer; Query owns remote-data
freshness and mutation state, not durable business storage. [T1], [T3], [A1],
[ADR 0002](../adr/0002-generate-sites-from-a-versioned-manifest.md).

**Important qualification:** Start's retrieved overview still calls it a **v1
Release Candidate**, feature-complete with an API considered stable, not
bug-free. Its published numeric version being `1.x` is not evidence that this
status has changed. Treat adoption as a bounded platform experiment with
explicit acceptance gates, not an automatic fleet conversion. [T1], [P1].

**Proposed meaning of the name:** `storefront` should select a **Frontend
variation**, not implicitly introduce a third kind of whole Site or select a
commerce backend. The glossary currently defines Variant as `content` or
`commerce`; there is no separate Frontend selector in schema v1. Resolve that
terminology before adding a CLI flag. A possible future manifest shape is
`variant: "commerce"` plus `frontend: { variant: "storefront" }`; **this is not
accepted by the current schema and is not an executable example**.
[Glossary](../../GLOSSARY.md), [schema](../../src/manifest/schema.mjs).

Do not quietly equate `commerce` with a working ecommerce scaffold: `gq new`
currently refuses it, and its release/verify/doctor defaults are empty. The
first WooCommerce integration does not by itself supply those missing
generation defaults. A Frontend pilot can answer framework/deployment
questions with synthetic data before production integration is ready. [New command](../../src/sync/new.mjs),
[variant defaults](../../src/manifest/site-settings.mjs).

## Framework choice and tradeoffs

The capability statements below are documented facts; the fit assessments are
recommendations for this request, not benchmarks.

| Direction                                  | Documented capability                                                                                                                                                                                                | Fit and tradeoff                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Start + Router + Query**                 | Start builds on Router and provides full-document SSR, streaming, server functions, server routes and client/server builds. Query integration transfers cache data through SSR/hydration/streaming. [T1], [T3], [T4] | **Recommended.** One framework surface for indexable public pages and interactive shopping. Adds server deployment, hydration and security responsibilities; carries Start RC risk.                                                                                                      |
| **Router + Query SPA**                     | Router supplies routing/data-loading/search validation; Query can own external data. Start's overview suggests Router alone when Start's server features are unnecessary. [T1], [T5], [T6]                           | Smaller server surface if an existing backend exposes browser-safe APIs. Public catalog HTML/metadata would need another rendering strategy; not the default recommendation for an indexable storefront.                                                                                 |
| **Router + Query with hand-built SSR**     | Router documents SSR handlers, loader dehydration/hydration and streaming; its SSR guide labels the APIs experimental until Start is stable. [T2]                                                                    | Possible, not an escape from all Start-related SSR risk. Requires owning server/client entries and deployment wiring that Start supplies. Choose only for a concrete unsupported Start requirement.                                                                                      |
| **Keep Astro, add React shopping islands** | The current app skeleton and deploy resource are Astro server output. [Frontend config](../../blueprint/templates/apps/frontend/astro.config.mjs), [deployment](../../blueprint/templates/infra/frontend.run.ts)     | Retains the content reference site's rendering model, but creates a different integration problem around cart/account state and route transitions. Worth considering if preserving an existing Astro site is the dominant constraint; not a complete TanStack-routed Frontend by itself. |

Start supports both Vite and Rsbuild in the retrieved docs. **Proposed choice:
Vite**, because the repository's generated workspaces already use the
Vite+/Vite ecosystem and both Cloudflare and Alchemy document this path. There
is no demonstrated repository benefit to introducing Rsbuild or a Node/Nitro
server just for this variation. [T1], [C1], [A1],
[workspace configuration](../../blueprint/templates/pnpm-workspace.yaml).

Query is optional in Start, not a requirement to fetch anything. Router's
loaders already coordinate data loading. **Proposed division:** use Query for
catalog/search/cart resources shared across screens and mutation invalidation;
use Router for navigation, validated URL state, pending/error/not-found UI,
and simple route-only data. Avoid two independently configured caches for the
same commerce resource. [T3], [T5].

## Repository integration: facts and future seams

### Current generation and ownership

- Schema v1 is a strict Zod object with only `content` and `commerce` variants;
  editor JSON Schema is generated from it. Unsupported keys are not extension
  points. [Schema](../../src/manifest/schema.mjs),
  [schema generator](../../scripts/generate-schema.mjs),
  [manifest reference](../reference/manifest.md).
- `gq new` generates a content Site, sets its WordPress plugin list, writes its
  files and initializes Git. Its printed next steps are content-specific
  provisioning, publication-store preparation and readiness checks. The
  interactive commerce choice is disabled. [New command](../../src/sync/new.mjs),
  [generation tests](../../test/sync/new.test.mjs).
- `blueprint/ownership.json` is authoritative. The planner currently traverses
  one ownership list without selecting entries by Frontend or Site variant;
  app files are create-once and written as a skeleton only while the app
  directory is absent. Existing app directories gain no missing skeleton
  files on ordinary sync. [Ownership](../../blueprint/ownership.json),
  [`planManagedFiles`](../../src/sync/managed-files.mjs),
  [create-once tests](../../test/sync/create-once.test.mjs).
- Fully generated deploy/infra files are different: sync updates them and
  refuses unexpected local edits using lock hashes. Changing the selected
  Frontend cannot safely be implemented by hand-editing a managed deploy
  file. [Planner](../../src/sync/managed-files.mjs),
  [deploy generation tests](../../test/sync/deploy-files.test.mjs).
- The initial root scripts delegate `dev`, `build`, `check`, `lint`, `format`
  and `test` to `@<project>/frontend`; those initial values are site-owned
  after creation. Content doctor explicitly requires `astro.config.mjs`, and
  content verify/release have their own defaults. A TanStack variation needs
  defaults resolved from both Site kind and Frontend choice rather than only
  copying the app directory. [Initial package](../../blueprint/templates/package.initial.json),
  [source map](../../blueprint/README.md),
  [settings](../../src/manifest/site-settings.mjs),
  [defaults tests](../../test/manifest/variant-defaults.test.mjs).

**Proposed selector design:** retain `variant` for Site kind and add one bounded,
validated Frontend choice named `storefront`. Keep existing content Sites on
Astro by default. Define allowed combinations explicitly; do not assume that
`content + storefront`, all existing commerce Sites, or a backend-free Site
are supported. Introducing the selector should use an explicit schema evolution
and pure migration that preserves old behavior, with older CLI refusal, rather
than guessing framework choice from installed packages.
[ADR 0002](../adr/0002-generate-sites-from-a-versioned-manifest.md),
[migrations](../../src/manifest/migrations.mjs),
[schema/migration tests](../../test/manifest/schema-and-migrations.test.mjs).

If the intended request is instead literally **`gq new --variant storefront`**,
that is a third **whole-Site Variant**, not just a Frontend variation. It would
need coherent CMS/plugin, deploy, release, verify and readiness defaults and a
revisited domain decision. Neither approach should rename existing commerce
Sites or migrate their site-owned apps automatically. The proposed separation
extends the current model; treating storefront as a third Site kind conflicts
with the present glossary and ADR 0002's v1 vocabulary.
[Glossary](../../GLOSSARY.md),
[ADR 0002](../adr/0002-generate-sites-from-a-versioned-manifest.md).

### Deployment and content assumptions to avoid carrying over

The fully generated `infra/frontend.run.ts` currently declares
`Cloudflare.Website.Astro`, configures hostnames/stages, and adds D1 publication
storage and two secrets if `apps/frontend/migrations` exists. The deploy script
also uses that directory as the publication-store signal and always supplies
`PUBLIC_WORDPRESS_GRAPHQL_URL`. This is an Astro/content deployment, not a
framework-neutral wrapper. A commerce app's unrelated migrations must not
accidentally opt it into publication storage and refresh credentials.
[Deploy resource](../../blueprint/templates/infra/frontend.run.ts),
[deploy script](../../blueprint/templates/infra/scripts/deploy-frontend.mjs).

The release step requires CMS/Ploi credentials and deploys the CMS first, then
the Frontend; `v*` tags trigger releases. Reusing this flow is reasonable if the
new Frontend still belongs to a Site with that CMS, as the first WordPress +
WooCommerce integration does. Backend-agnostic design must still avoid assuming
that every future adapter uses Ploi/WordPress; a standalone Frontend deployment
cannot be assumed to fit this flow unchanged.
[CI release script](../../blueprint/templates/scripts/ci-release.mjs),
[tag predicate](../../blueprint/templates/infra/ci/release.ts).

The content guarantees are specifically about **published WordPress pages,
posts and shared settings**, with durable last-known-good reads, signed events,
withdrawals, retry and reconciliation. They do not specify product prices,
stock, carts, orders or commerce authentication. **Proposed boundary:** do not
use that indefinitely retained publication data as transaction authority, and
do not retrofit commerce events into it without a separate consistency
contract. If storefront also serves editorial content, explicitly decide
whether it preserves these guarantees and port the HTTP adapters without
weakening their behavior. [ADR 0003](../adr/0003-serve-published-content-from-a-durable-store.md),
[ADR 0004](../adr/0004-serve-entries-from-the-store-with-a-cold-lookup.md),
[ADR 0005](../adr/0005-refresh-publications-through-signed-cms-events.md),
[ADR 0006](../adr/0006-withdraw-publications-through-signed-cms-events.md),
[ADR 0007](../adr/0007-refresh-shared-settings-through-settings-events.md),
[ADR 0008](../adr/0008-retry-event-delivery-from-the-cms-on-a-server-cron.md),
[ADR 0009](../adr/0009-reconcile-missed-changes-on-the-cms-scheduler.md).

`gq site check` is a content resilience gate: CMS fields, prepared publication
store, secrets, reconciliation and independent media. Its implementation does
not choose a commerce-specific gate from the manifest. **Proposed change:**
make applicability explicit; do not report storefront commerce readiness from
that gate or call a green catalog page proof of checkout readiness.
[ADR 0010](../adr/0010-declare-a-new-content-site-ready-through-one-readiness-gate.md),
[command](../../src/site/commands.mjs), [gate](../../src/site/readiness.mjs).

### Files to revisit during implementation, not changes made here

| Seam                            | Existing files                                                                                                                                                                                                                                                                                                                                               | Proposed future change                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public configuration            | [`src/manifest/schema.mjs`](../../src/manifest/schema.mjs), [`migrations.mjs`](../../src/manifest/migrations.mjs), [`site-settings.mjs`](../../src/manifest/site-settings.mjs), [`schema/gq.ops.schema.json`](../../schema/gq.ops.schema.json)                                                                                                               | Validate the selector/allowed combinations; preserve defaults through a migration; regenerate schema. Resolve framework-specific doctor/check/release settings.                               |
| CLI generation/sync             | [`src/sync/new.mjs`](../../src/sync/new.mjs), [`commands.mjs`](../../src/sync/commands.mjs), [`managed-files.mjs`](../../src/sync/managed-files.mjs), [`blueprint/ownership.json`](../../blueprint/ownership.json)                                                                                                                                           | Select skeleton and managed deploy sources from validated choices. Adapt prompts/help/provisioning and `--recreate` to the active skeleton. Continue offline generation and conflict refusal. |
| App source                      | [`blueprint/templates/apps/frontend/`](../../blueprint/templates/apps/frontend/), [`blueprint/README.md`](../../blueprint/README.md)                                                                                                                                                                                                                         | Keep the Astro source intact; introduce a distinct source tree for the storefront skeleton, mapped to the same site target `apps/frontend`. Document source selection.                        |
| Toolchain/workspace             | [`pnpm-workspace.yaml`](../../blueprint/templates/pnpm-workspace.yaml), [`package.initial.json`](../../blueprint/templates/package.initial.json), [`fragments/package.keys.json`](../../blueprint/templates/fragments/package.keys.json), [`mise.toml`](../../blueprint/templates/mise.toml)                                                                 | Add only verified React/Start/Query dependencies and plugin-compatible pins; retain root command surface and runtime policy. Do not globally upgrade content Sites incidentally.              |
| Worker deployment               | [`infra/frontend.run.ts`](../../blueprint/templates/infra/frontend.run.ts), [`infra/scripts/deploy-frontend.mjs`](../../blueprint/templates/infra/scripts/deploy-frontend.mjs), [`infra/package.json`](../../blueprint/templates/infra/package.json)                                                                                                         | Select Astro versus Vite resource; preserve names/domains/stages/secrets ownership. Replace accidental directory-based content capability detection for the new path.                         |
| Release and runtime credentials | [`scripts/ci-release.mjs`](../../blueprint/templates/scripts/ci-release.mjs), [`infra/ci/cloudflare.ci.ts`](../../blueprint/templates/infra/ci/cloudflare.ci.ts), [`infra/ci/env.ts`](../../blueprint/templates/infra/ci/env.ts), [`src/ci/deploy.mjs`](../../src/ci/deploy.mjs), [`src/cloudflare/deploy-token.mjs`](../../src/cloudflare/deploy-token.mjs) | Audit needed credentials/resources once backend integration is known. Keep runtime commerce credentials separate from deploy authority and out of generated files.                            |
| Operational applicability       | [`src/site/readiness.mjs`](../../src/site/readiness.mjs), [`src/frontend/commands.mjs`](../../src/frontend/commands.mjs), [`src/ploi/events.mjs`](../../src/ploi/events.mjs)                                                                                                                                                                                 | Keep content commands scoped to their actual capabilities; add storefront acceptance criteria only after its backend contract is known.                                                       |
| Regression proof and guidance   | [`test/sync/`](../../test/sync/), [`test/manifest/`](../../test/manifest/), [`scripts/smoke/`](../../scripts/smoke/), [`docs/guides/sites.md`](../guides/sites.md), [`docs/reference/manifest.md`](../reference/manifest.md)                                                                                                                                 | Add cross-selection generation/upgrade tests and a Start runtime proof, preserving Lombardi/content evidence. Explain the selector, ownership and supported scope.                            |

## TanStack implementation facts and suggested usage

### Routing, fetching and rendering

Start's basic structure is `src/router.tsx` and `src/routes/__root.tsx` with
file-based routes under `src/routes`; the Start plugin generates
`routeTree.gen.ts`. It is not an Astro `src/pages` app. Router validates search
parameters through `validateSearch` and makes search-dependent loading explicit
with `loaderDeps`. [T7], [T6], [T5].

**Proposed route scheme:** `/`, `/products`, `/products/$slug`,
`/categories/$slug`, `/search`, `/cart`, `/checkout`, and `/account` with account
subroutes only for capabilities the backend actually supports. Keep filters,
sort, pagination and search text in validated URL state; include all
result-changing values in loader dependencies and Query keys. Locale/currency
belong there only if the Site supports them. This makes direct links and
client navigation testable against the same normalized inputs. [T3], [T6].

A plain loader is **isomorphic**: initial SSR runs on the server, but client
navigation can execute it in the browser. Privileged reads must therefore go
through server functions or another authorized server endpoint, not a secret
embedded in a loader. `.server.*` modules have import protection; a filename or
TypeScript type is not a substitute for endpoint authorization. [T8], [T9].

For shared remote data, create a fresh `QueryClient` inside `getRouter` for each
SSR request and wire `setupRouterSsrQueryIntegration` from
`@tanstack/react-router-ssr-query`. The integration owns provider wrapping and
hydration; do not independently dehydrate the same cache. Await critical data
in the loader with shared query options, then read those options through
`useSuspenseQuery`. Set Router preload freshness to defer to Query when Query
owns that resource. Choose actual freshness windows per resource, not a
universal example constant. [T3], [T4].

**Proposed initial HTML contract:** await product identity, title, primary
catalog data and existence checks before rendering. Stream optional secondary
content only after primary status/head decisions are known. Plain `useQuery`
is not a guarantee of server-rendered data; the integration says it does not
execute on the server. Query invalidation updates Query, while
`router.invalidate()` updates Router-owned context/data; neither purges a CDN
or changes a commerce backend's state. [T3], [T4].

Start enables SSR by default and offers route `head` metadata, canonical links,
structured-data scripts, selective SSR and prerendering. Its SEO guide supports
static or server-route sitemaps; automatic crawling-based sitemap generation is
associated with prerendering, not discovery of every dynamic backend product.
These are capabilities, not a search-ranking guarantee. [T10].

**Proposed SEO policy:** SSR product/category content and metadata; use stable
canonical URLs, backend-confirmed availability in any product structured data,
and an explicit filtered/search-page indexing policy. Keep cart, checkout and
account out of indexing and public prerendering. Start with dynamic catalog
SSR rather than freezing changing commercial information at build time.
Decide sitemap enumeration with the backend and test raw HTML, not only the
hydrated DOM. Unknown upstream availability must not be rendered as confirmed
missing content: preserve the repository's 404-versus-503 distinction where
applicable. [T10], [Glossary](../../GLOSSARY.md).

### Server functions and security boundaries

Server functions (`createServerFn`) are same-origin application RPCs compiled
to client stubs. Use them for app-initiated reads/mutations; use **server routes**
for externally invoked HTTP endpoints such as callbacks or events. Start can
place those handlers alongside UI routes. This does not select where orders,
sessions or payments are stored. [T11], [T12].

The following are **proposed safeguards**, grounded in Start's documented
endpoint and execution boundaries, not claims that the blueprint already has a
commerce security implementation. [T8], [T9], [T11].

- Validate server inputs at runtime; authorize every private read/mutation,
  including cart/account/order ownership, in its handler or middleware.
  `beforeLoad` redirects are UX, not the data boundary. Use POST for mutations.
- Preserve CSRF protection. Current docs install `createCsrfMiddleware()` for
  server functions when no custom `src/start.ts` exists; with a custom one,
  install it explicitly. Configure/verify public-origin behavior behind the
  actual host/proxy. Server routes need protection appropriate to their caller:
  browser mutations and provider-signed callbacks are different trust paths.
- Keep provider secrets in server-only request-time code and Worker bindings,
  never `VITE_*`, HTML, Query keys, serialized loader data or logs. Do not carry
  over a Node filesystem assumption merely because a server function is called
  “server-side.” Cloudflare is a distinct runtime. [C1].
- Personalized HTML/RPC data must not be publicly cached; initially use
  `Cache-Control: private, no-store` and verify final responses through the
  host/CDN. Use request-scoped QueryClients and clear private browser queries
  on logout/account switch. Cache identity is not authorization. [T3], [T11].
- If this app owns a session cookie, use HttpOnly/Secure and an explicit
  SameSite policy; a `__Host-` cookie additionally has no Domain and `Path=/`.
  Backend/identity-provider integration determines the session lifecycle;
  do not scaffold a new password database as an incidental Frontend feature.
  [T9].
- The commerce authority must confirm prices, stock and checkout totals; never
  accept them because the browser supplied them. Agree retry/idempotency and
  completion verification with the chosen backend. A checkout-return URL must
  not alone establish a paid order. Do not collect raw card details in this
  scaffold; prefer a backend/provider-owned checkout flow when it supports one.
  These are design constraints; the first WooCommerce adapter's verified APIs
  and unresolved gateway choices are detailed below, not promises of generic
  provider capabilities.
- Add abuse controls and redacted diagnostics at mutation/auth/search
  boundaries based on actual backend limits. Authenticating a request does not
  bound its cost. Start's authentication guide discusses rate limiting, but
  does not supply a commerce provider's quota policy. [T9].

## First adapter: WordPress + WooCommerce

**Settled scope:** WooCommerce is the first adapter, while the Frontend's
contract remains backend-neutral. The following are **verified upstream APIs**,
not evidence that the current content skeleton installs WooCommerce or that a
particular gateway works headlessly.

### API separation and cart identity

- **Store API:** `/wp-json/wc/store/v1` supplies customer-facing public products,
  session-scoped carts and checkout; it is not the administrative API and does
  not use a merchant consumer key/secret. Product collections support search,
  slug/category filters and pagination; categories have their own endpoint.
  Only published products are returned. Password-protected products still
  expose prices/images while descriptions are redacted; do not treat them as
  equivalent to the repository's restricted WordPress entries. Variations are
  excluded from default collections and can be requested with `type=variation`.
  [W1], [W2], [W14].
- **Privileged WC REST API:** `/wp-json/wc/v3` supports store-wide data management,
  including customers/orders. Consumer keys have read/write scopes and inherit
  the associated WordPress user's roles/capabilities; HTTPS Basic Auth uses the
  key and secret. **Proposal:** do not require these keys for public catalog or
  ordinary guest cart operations. Any genuinely needed administrative/customer
  bridge belongs server-side with least privilege, never in browser code or
  query-string credentials. [W9], [W10].
- Store API carts normally follow the Woo cookie session/current user. For
  headless use, `GET /cart` returns a `Cart-Token` header; successful cart calls
  return tokens that identify the cart on subsequent Cart/Checkout requests.
  A Cart Token replaces cookie-based cart identity and removes the Store API
  nonce requirement for those calls. It is **not a customer login or merchant
  API key**. The current token session handler loads the session identified by
  the signed token; it does not establish a WordPress login. [W1], [W3], [W4],
  [W15].
- Otherwise, cart POSTs and all Checkout calls require `Nonce`, minted in
  WordPress with `wp_create_nonce('wc_store_api')`; successful responses provide
  an updated nonce to retain. This is distinct from WordPress REST cookie auth's
  `X-WP-Nonce`/`wp_rest`. WordPress explicitly says nonces are not authentication
  or authorization; do not disable Woo nonce checks in production. [W5], [WP1],
  [WP2].

**Proposed first transport:** same-origin Start functions call the Woo adapter;
keep the upstream Cart Token inside a protected HttpOnly session envelope or
server-side session mapping, resolved from the request, not in Query keys,
serialized HTML, logs or a global server client. Treat it as sensitive cart
access material, even though Store API is called “unauthenticated.” Bootstrap
and propagate identity consistently on SSR and client navigation, with private
no-store responses. Retain Start CSRF/origin protections on this cookie-backed
boundary even when Woo accepts a Cart Token without a nonce. This proposed
transport is not a built-in Woo session bridge. Token expiry/recovery,
concurrent cart mutations, guest-to-account merging and cookie/domain behavior
must be tested on the pilot; a browser navigating to the Woo checkout host does
**not** automatically attach a server-held Cart Token. [W4], [T3], [T9], [T11].

### Checkout, gateways and accounts: verified surfaces, unresolved choices

`GET /checkout` returns checkout data including a **draft order**; do not
speculatively preload it like a side-effect-free catalog read. `POST /checkout`
submits addresses, a gateway `payment_method` and gateway-specific
`payment_data`, returning `payment_result` including a redirect URL. The current
docs offer `expected_total` to detect a changed total with 409, but this must be
checked against the installed Woo version. Woo explicitly cannot prescribe
all gateways' payment payloads. Blocks integrations register payment UI/client
scripts separately from gateway processing; legacy `process_payment` handling
exists, with a Store API hook for advanced cases. **Blocks compatibility is
not proof that its scripts/UI work in this TanStack app.** [W6], [W7].

**Proposed lowest-risk first checkout candidate:** hand off to Woo-hosted
checkout, where the Site's gateway integration already runs, after proving
cart/identity transfer. Official `/checkout-link/?products=...&coupon=...`
links can populate a checkout cart with product quantities and documented
variation/cart-item data. They establish a Woo checkout session; they are not
an arbitrary Cart-Token-to-cookie bridge or a promise to preserve all addresses,
shipping selections, discounts and extension state. Verify feature availability
on the pinned Woo version and reject unsupported cart reconstruction rather
than silently losing state. [W8].

A headless Store API checkout followed by `payment_result.redirect_url` is
another **candidate**, not a settled gateway-neutral implementation. Gateway
API docs support offsite form/redirect flows, but even their cheque example
returns success/thank-you while the order is **on hold**, not paid. Validate
redirect destinations and let Woo/the gateway remain payment authority; the
browser's return URL or generic `success` must not mark an order paid.
Gateway SDK/tokenization, callbacks, saved methods and additional authentication
(e.g. 3-D Secure) need that gateway's own verified contract and sandbox tests.
Do not import its raw `payment_data` schema into the neutral core. [W6], [W13].

Customer accounts remain a separate authentication decision. WordPress's
ordinary REST cookie auth relies on its logged-in session and REST nonce;
Application Passwords support remote HTTPS API authentication, not automatic
shopper browser login/SSO. A Woo Cart Token alone does not establish that user.
Store API is not a customer-directory/account-order-history API. [WP1], [W1],
[W4]. Its narrow `/order/:id` endpoint docs require an order key and guest
billing email; the **current source** instead explicitly checks the current
user against registered-order ownership and requires key/email for guest
orders. This docs/source distinction makes version-specific authorization tests
mandatory, not optional. Neither surface permits a generic unrestricted order
lookup. [W11], [W12].

**Proposed account boundary:** defer account/order-history UI until a customer
authentication/session bridge is selected. If a privileged service key reads
orders on the shopper's behalf, derive the Woo customer identity from a verified
session, enforce ownership on both lists and single reads, and never trust a
browser-supplied `customer_id` filter as authorization. Keep guest order proofs
private and distinct from account authentication. Woo's REST order schema
identifies `customer_id: 0` as guest ownership; sharing that value does not make
all guest orders one customer's orders. [W10], [T9].

### Minimal backend-neutral boundary (proposal)

Use a small explicit interface behind Start server functions, not a generic
Woo REST proxy or a speculative multi-provider plugin system:

| Operation                                           | Client-safe contract                                                                                                     | Woo mapping confined to `woo.server.ts`                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List/search products, read product, list categories | Validated filters, opaque product/category references, paged display models and explicit missing/unavailable outcomes    | Store API paths/query names, numeric IDs, variation attributes and catalog visibility rules. [W1], [W2]                                                |
| Read cart, add line, set quantity, remove line      | Request-resolved shopper context; opaque purchasable/line references; backend-confirmed `CartView` and actionable errors | Cart Token/nonce/cookie handling; product/variation IDs on add, cart item `key` on update/remove; full cart and 409 conflict mapping. [W3], [W4], [W5] |
| Begin checkout                                      | A supported handoff/action result plus safe public reference; never a universal “paid” boolean                           | Woo checkout-link reconstruction or tested Store API/gateway flow; order keys and payment statuses stay private/backend-specific. [W6], [W8]           |
| Optional customer/order views                       | Verified principal and ownership-checked public result; absent until supported                                           | WordPress/Woo session/customer identity and privileged reads, if needed. [WP1], [W10], [W12]                                                           |

Normalize display money to **currency plus an exact decimal amount string**
without binary floating-point arithmetic; map Woo Store API minor-unit strings
using `currency_minor_unit` rather than assuming two decimals or confusing them
with WC REST decimal-price strings. Keep optional price ranges, availability and
tax/display context explicit; prices/totals remain backend-authoritative.
Handle provider HTML descriptions through an explicit rendering/sanitization
policy. Return only supported display data, not raw Woo extension blobs. [W2],
[W3], [W9].

Expose only verified capabilities: initially bound supported product types,
filters and checkout mode, with explicit unsupported outcomes for extensions
such as bundles/subscriptions until tested. Coupons, shipping packages, account
creation and gateway-specific actions need not become mandatory methods for
every future backend. Woo-specific transport, IDs, error codes and payment
payloads stay server-side; the client may receive opaque references but never
needs to understand `pa_*`, `Cart-Token`, WordPress nonces or raw Woo statuses.
Backend neutrality means a replaceable narrow adapter, not identical semantics
or feature parity across all commerce systems.

The existing content CMS Composer/plugin defaults do not include WooCommerce.
A future first-adapter generation slice must add its tested CMS dependency and
declarative activation (and any required Site-owned bridge), rather than assume
WPGraphQL supplies these Store/REST endpoints. Keep that adapter's setup separate
from the framework-only storefront skeleton. [CMS package](../../blueprint/templates/apps/cms/composer.json),
[new command](../../src/sync/new.mjs).

## Cloudflare deployment and toolchain compatibility

### Preferred: keep Alchemy as deployment owner

Alchemy's current official Cloudflare Start guide uses **`Cloudflare.Website.Vite`**,
not a Cloudflare `Website.TanStackStart` resource. It tells the application to
remove `@cloudflare/vite-plugin`, because Alchemy layers its integration onto
the Vite build; adding both would not follow that documented ownership model.
It documents static assets plus SSR fallthrough, bindings, and a lazy binding
access workaround for Start dev mode. [A1].

This is not merely an unverified API from future `main`: the repository-pinned
**Alchemy 2.0.0-beta.79** npm artifact contains and exports
`src/Cloudflare/Website/Vite.ts`. Its implementation maps the Website to a
Worker with Vite build options, and its documentation explicitly describes
TanStack Start SSR. The matching frontend-frameworks artifact exposes the Vite
integration. **Verified: API/source availability. Not verified: a storefront
build, hydration, binding access or production deploy with the full pinned
workspace.** [A2], [A3],
[repository pins](../../blueprint/templates/pnpm-workspace.yaml).

**Proposed deployment:** select that Vite resource in the managed deployment
source for storefront, preserving the existing Worker identity,
`rootDir: "../apps/frontend"`, stages, domains, secret handling and Alchemy state.
Do not attach the content D1 store unless editorial-publication support is an
explicit capability. Verify production and local binding access separately:
Alchemy's documented `alchemy dev` path uses **real cloud resources**, so it is
not an offline test fixture or permission to develop against production data.
[A1], [existing resource](../../blueprint/templates/infra/frontend.run.ts).

### Alternative: official Cloudflare plugin + Wrangler

TanStack and Cloudflare document a direct path with
`cloudflare({ viteEnvironment: { name: "ssr" } })`, then `tanstackStart()`, then
the React Vite plugin. Source Wrangler config uses
`main: "@tanstack/react-start/server-entry"`, `nodejs_compat`, a selected
compatibility date and observability; build/deploy uses Vite plus Wrangler.
Bindings are available from `cloudflare:workers`, and types can be generated
with `wrangler types`. The TanStack example supplies concrete config and
package manifests. [T13], [C1], [T14].

**Proposed fallback only:** use this if the Alchemy pilot fails a bounded
acceptance gate that cannot be fixed within the agreed budget. Switching to
Wrangler requires an explicit deploy/state/domain/secrets ownership plan and
changes to managed CI wiring; do not run it beside Alchemy against the same
Worker. Do not copy Node/Nitro `.output` paths into the Alchemy build based on a
different host's example. The Cloudflare guide's generated-config summary and
source-config example are distinct; verify emitted artifacts in the chosen
pipeline rather than guessing paths. [C1], [A1],
[current deploy script](../../blueprint/templates/infra/scripts/deploy-frontend.mjs).

### Dependency facts versus compatibility gaps

- Root `gq-site` uses Vite+ **1.0.0**, but generated Sites still pin Vite+
  **0.3.0**, aliased Vite core **0.3.0**, Vitest **4.1.11**, Alchemy/frontend
  frameworks **2.0.0-beta.79**, and Effect **4.0.0-rc.115**. A root tooling
  migration is not a generated-site upgrade. Generated Node is **24.21.0** and
  pnpm **12.6.0**. [Root package](../../package.json),
  [workspace](../../blueprint/templates/pnpm-workspace.yaml),
  [toolchain pin](../../blueprint/templates/mise.toml),
  [managed package keys](../../blueprint/templates/fragments/package.keys.json).
- Retrieved Start metadata resolves to **1.168.60**, Node `>=22.12.0`, with
  Vite peer `>=7.0.0` and React/React DOM `>=18.0.0 || >=19.0.0`. Router resolves
  to **1.170.41**. The SSR Query integration **1.167.3** requires Query/core
  `>=5.102.0` and Router `>=1.170.33`; Query resolves to **5.104.1**. Packages do
  not all share one version number. These are observation snapshots, not
  recommended untested pins. [P1], [P2], [P3], [P4].
- The pinned Alchemy artifact declares Vite peer `^8.0.7`; frontend-frameworks
  declares Vite `^7.0.0 || ^8.0.0` and React plugin `^6.0.2`. Its peers include
  optional framework integrations; their presence is not a requirement to
  install every framework. [A2], [A3].
- Current Vite+ docs describe Vite 8/Rolldown builds with ordinary Vite
  configuration/plugins and bundled Vitest 5.0.1. Those docs alone do not
  establish compatibility of the older generated-site alias with Start,
  React/Cloudflare plugins, Alchemy build-child resolution or SSR transforms.
  The generated workspace's `peerDependencyRules.allowedVersions` is not a
  runtime compatibility proof. [V1], [V2],
  [workspace](../../blueprint/templates/pnpm-workspace.yaml).

**Proposed tooling gate:** keep the pinned Node/pnpm surface, select one tested
React/Start/Router/Query/plugin combination and commit its Site lockfile during
future implementation. Test the actual generated workspace's dependency
resolution, not just an isolated upstream example. Keep `check` as type/static
validation (`tsc --noEmit` plus lint/format as appropriate) and make `build` a
real Start/Vite production build. Today's Frontend `build` is only `astro check`;
its tests use Astro config/Container APIs. They cannot be relabeled as a
TanStack build/runtime proof. [App package](../../blueprint/templates/apps/frontend/package.json),
[test config](../../blueprint/templates/apps/frontend/vitest.config.ts),
[upstream example](https://github.com/TanStack/router/blob/main/examples/react/start-basic-cloudflare/package.json),
[runtime harness](../../scripts/smoke/frontend-runtime-lib.mjs).

## Proposed storefront scope and app-skeleton shape

This is a suggested capability map, **not a settled checkout/authentication
contract**. Backend neutrality and the first WordPress + WooCommerce integration
are fixed constraints; the specific Site's product types, extensions and
transaction behavior still need verification.

| Area              | Initial Frontend scope                                                  | Backend-dependent questions / boundaries                                                                                                             |
| ----------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog           | SSR listing with pagination, links, loading/error/empty states          | Source of products, visibility rules, pagination and supported filters; empty results versus provider failure                                        |
| Product           | SSR name/description/media; option selection and add-to-cart affordance | Stable identity/slug, variant options, authoritative currency/price/stock; no invented product schema                                                |
| Category          | SSR category and product listing; navigable hierarchy only if supplied  | Taxonomy semantics and category/product associations                                                                                                 |
| Search            | URL-driven query/filter/sort state and result feedback                  | Provider search API, limits, ranking and indexing policy; no new search service by default                                                           |
| Cart              | Read/add/change/remove and confirmed mutation feedback                  | Anonymous versus authenticated identity, persistence/merge policy, totals and quantity rules; no assumption that localStorage is the order authority |
| Checkout          | A handoff/start action and return/cancel/error states                   | Hosted redirect versus embedded/custom flow, checkout session creation, trusted completion and retry semantics                                       |
| Account           | A route boundary and optional sign-in/profile/order views               | Identity/session provider, account capabilities and ownership checks; can be deferred if guest-only checkout is the agreed scope                     |
| Editorial content | Optional navigation/legal/marketing pages                               | WordPress is present in the first integration; editorial routes and content resilience guarantees remain to be scoped                                |

**Proposed source organization:** preserve target-shaped sources as recommended
by the blueprint source map. Add a separate source root such as
`blueprint/variants/storefront/apps/frontend/` (not present today), with ownership
entries mapping selected sources to `apps/frontend/*`. Do not mix Astro and
Start entry files into one skeleton or rely on deleting the wrong files after
generation. [Source map](../../blueprint/README.md),
[ownership](../../blueprint/ownership.json).

Suggested Site output, **all new app paths below are proposals**:

```text
apps/frontend/
  package.json, tsconfig.json, vite.config.ts
  .env.example, .gitignore, README.md, public/
  src/router.tsx
  src/start.ts                    # explicit middleware/CSRF if supplied
  src/routes/__root.tsx           # document shell, head and scripts
  src/routes/index.tsx
  src/routes/products.index.tsx
  src/routes/products.$slug.tsx
  src/routes/categories.$slug.tsx
  src/routes/search.tsx
  src/routes/cart.tsx
  src/routes/checkout.tsx
  src/routes/account.tsx          # only enabled when supported
  src/commerce/contracts.ts       # client-safe normalized inputs/results
  src/commerce/queries.ts         # shared keys/options
  src/commerce/*.functions.ts     # validated server-function boundary
  src/commerce/woo.server.ts      # first adapter; Woo mapping stays server-side
  src/components/, src/styles/, src/test/
```

Start's generated `routeTree.gen.ts` is tool output, not a hand-maintained
blueprint-managed file. Decide its ignore/commit policy explicitly. An optional
custom `src/server.ts` is needed only if default server-entry behavior is
insufficient. The proposed scaffold file names follow Start's documented
router/root and server-function/server-only separation. [T7], [T8], [T11], [C1].

**Proposed ownership:** app package/routes/components/styles/provider adapter,
its tests and env examples are create-once, then site-owned. Deploy wrapper,
framework selection and common toolchain policy remain blueprint-managed.
Reusable runtime behavior should eventually live in versioned packages if it
must be updated across Sites: changing an app-skeleton source does not update
existing copies. This preserves ADRs 0001/0002 rather than introducing managed
business UI files. [ADR 0001](../adr/0001-the-getquick-site-blueprint.md),
[ADR 0002](../adr/0002-generate-sites-from-a-versioned-manifest.md),
[create-once tests](../../test/sync/create-once.test.mjs).

Begin with the small client-safe contract below and **one WooCommerce adapter**
behind server boundaries, plus synthetic fixtures for the framework spike.
Avoid a speculative plugin registry, a fake checkout advertised as production,
or a Woo SDK imported directly throughout components. Enable capabilities only
after their actual API and security contract is verified; future adapters must
not be required to implement WordPress nonces, Woo cart tokens or Woo order
statuses.

## Bounded rollout and testing plan

All steps below are **proposed future work**, not tests performed here.

1. **Resolve the remaining product boundary.** Preserve backend neutrality and
   WordPress + WooCommerce as the first integration. Confirm Frontend selector
   versus whole-Site Variant, pilot WooCommerce version/extensions/gateways,
   editorial scope, guest/account scope and checkout/handoff model. Record a
   later ADR only after a decision. Do not enable commerce generation by simply
   removing its current refusal.
2. **Framework/deploy spike, no commerce authority.** Use synthetic catalog
   responses and two isolated cookie identities. On the exact candidate
   generated-site workspace, prove SSR HTML/head, direct product URLs, URL
   filters, hydration, client navigation and Query mutation invalidation. Build
   through pinned Alchemy Vite and serve the emitted Worker in local workerd.
   Prove binding access and public/private headers without production secrets.
   If this fails, compare the documented direct Cloudflare pipeline in a
   disposable environment; decide one deployment owner before proceeding.
3. **Offline generation slice.** Implement validated selection, migrations,
   variant-aware ownership and framework defaults. Run generation/sync tests
   for fresh content, storefront and adoption of existing app directories.
   Require repeatable output, empty second-sync diff, no network/secrets,
   managed-edit refusal, deletion preservation and active-skeleton recreation.
   Assert no Astro artifacts in new storefront output and no storefront
   artifacts in content output. Existing tests provide these behavioral seams:
   [new](../../test/sync/new.test.mjs),
   [ownership](../../test/sync/ownership.test.mjs),
   [create-once](../../test/sync/create-once.test.mjs),
   [managed keys](../../test/sync/managed-keys.test.mjs),
   [deploy files](../../test/sync/deploy-files.test.mjs),
   [schema/migrations](../../test/manifest/schema-and-migrations.test.mjs),
   [defaults](../../test/manifest/variant-defaults.test.mjs).
4. **First WooCommerce adapter slice.** Test the backend-neutral contract against
   synthetic fixtures and the pilot's pinned Store API. Verify published versus
   unavailable products, variations/money mapping, two guest carts, expired or
   invalid tokens, nonce renewal where used, cart mutation conflicts, concurrent
   SSR isolation and no credential leaks. For account scope, test cross-customer
   order denial and guest order proofs; never trust a caller-supplied customer
   ID under a privileged service key. Test cross-origin mutations and logout
   cleanup. Start's Query example tests concurrent-cookie SSR, hydration reads
   and invalidation; it is a pattern, not proof of this adapter. [T3], [W2],
   [W3], [W4], [W5], [W11], [W12].
5. **Shopping acceptance.** Verify product option selection, rejected quantity,
   price/stock changes, mutation failure recovery, checkout start retry and
   return verification using WooCommerce and the chosen gateway's sandbox.
   Prove the cross-domain Woo checkout/cart handoff if used, including whether
   discounts, shipping, extension fields and customer identity survive; pin its
   supported feature/version set rather than promising arbitrary cart transfer.
   Decide exactly what
   “ready” means for catalog-only versus checkout-capable deployment. Test
   accessibility/keyboard forms, mobile behavior, no-JS public catalog HTML and
   measured JS/performance budgets. Do not require account/order screens for a
   deliberately guest-only initial scope.
6. **One staged pilot, then bounded promotion.** Prove custom domain, secrets,
   asset/SSR routing and backend outage behavior on a non-production Site.
   Run content regression proofs unchanged, including the existing generated
   Frontend and workerd harnesses. Observe failures and pause promotion on
   checkout/auth/data-isolation regressions. Preserve previous frontend
   artifacts and compatible backend contracts; rolling back UI code must not
   restore a database over newly placed orders. Only then widen support.
   [Current Frontend proof](../../scripts/smoke/frontend-check.sh),
   [runtime proof](../../scripts/smoke/frontend-runtime.sh),
   [acceptance harness](../../scripts/smoke/acceptance.sh),
   [rollout safety policy](../plans/getquick-blueprint-rollout.md).

## Open decisions and unverified gaps

- Is `storefront` specifically a Frontend variation on a commerce Site, or must
  the public command be a new whole-Site `--variant storefront`? Does the
  existing commerce phase-4 restriction remain, or is this request intended to
  supply its missing default generation path?
- Which WordPress/WooCommerce Site/version is the first pilot, and which product
  types, pricing/tax/shipping extensions and gateways must it support? Official
  API boundaries are verified below; the actual installation, extension schemas
  and runtime behavior are not. WooCommerce is the first backend, not an open
  provider-selection question.
- With WordPress present in the first integration, must storefront preserve the
  editorial publication-store/event/readiness guarantees, or is editorial
  rendering a later slice? Which routes own legal/marketing pages and avoid
  slug conflicts?
- Is the first checkout Woo-hosted, headless Store API plus gateway redirect,
  or embedded/custom, and guest-only or account-enabled? Which gateways support
  the exact flow? Who verifies payment completion, refunds and order history?
  How will guest cart identity migrate at login and across the Woo host? Which
  customer authentication/SSO mechanism establishes Woo's current user, and what
  data may the Frontend persist, if any?
- Are multiple locales, currencies, catalogs or customer-specific prices in
  scope? Which dimensions determine URL and Query identity, and which require
  private caching? What catalog scale and freshness/SEO policies are required?
- Can the exact generated Vite+ 0.3.0 alias + pinned Alchemy + selected current
  Start/React/Query plugins build, hydrate and read bindings correctly? Package
  availability/peer ranges are verified, **that combined execution is not**.
- Who owns shared commerce runtime updates versus Site-specific UI? What is the
  support/rollback policy across Start RC and the existing beta/RC infra pins?

## Verification performed

- Read the research convention and representative notes, repository agent/domain
  guidance, glossary, ADRs 0001–0010, schema/defaults, ownership/planner,
  generation and sync tests, Frontend/deploy/CI sources, and smoke harnesses.
  Checked referenced local paths against this checkout. These are source
  inspections, not evidence that the tests passed during this research.
- Retrieved the official TanStack/Cloudflare/Alchemy/Vite+ pages and TanStack
  example files cited below. Read source content rather than relying on search
  summaries. The initially attempted Start `/guide/build-from-scratch` URL was
  404; the cited canonical `/build-from-scratch` page was successfully fetched.
- Queried npm metadata and inspected pinned Alchemy/frontend-frameworks tarballs
  **in memory**, including the exported Vite resource and matching integration.
  Verified the API exists in beta.79; did not build/deploy an app or assert a
  full dependency-graph compatibility result.
- After the user clarification, retrieved official WooCommerce Store/REST API,
  cart token/nonce, checkout/gateway/handoff and WordPress authentication/nonce
  documentation, plus current Woo order authorization source. These establish
  intended APIs, not compatibility with an unspecified installed Woo version or
  gateway. No WooCommerce/gateway runtime or account/checkout flow was executed.
- Checked the finished note's local links and external citation URLs and used
  the repository's single kebab-case Markdown research convention. No code,
  manifest, schema, ADR or research index was changed; no commit was made.

## Primary external sources

TanStack documentation and examples (retrieved 2026-10-03):

- [T1] Overview and status; [T2] Router SSR; [T3] Start + Query; [T4] SSR Query integration.
- [T5] Data loading; [T6] Search parameters; [T7] Basic app structure; [T8] Execution model.
- [T9] Authentication server primitives; [T10] SEO; [T11] Server functions; [T12] Server routes.
- [T13] Hosting; [T14] Official Cloudflare example.

[T1]: https://tanstack.com/start/latest/docs/framework/react/overview
[T2]: https://tanstack.com/router/latest/docs/guide/ssr
[T3]: https://tanstack.com/start/latest/docs/framework/react/guide/tanstack-query
[T4]: https://tanstack.com/router/latest/docs/integrations/query
[T5]: https://tanstack.com/router/latest/docs/guide/data-loading
[T6]: https://tanstack.com/router/latest/docs/guide/search-params
[T7]: https://tanstack.com/start/latest/docs/framework/react/build-from-scratch
[T8]: https://tanstack.com/start/latest/docs/framework/react/guide/execution-model
[T9]: https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives
[T10]: https://tanstack.com/start/latest/docs/framework/react/guide/seo
[T11]: https://tanstack.com/start/latest/docs/framework/react/guide/server-functions
[T12]: https://tanstack.com/start/latest/docs/framework/react/guide/server-routes
[T13]: https://tanstack.com/start/latest/docs/framework/react/guide/hosting
[T14]: https://github.com/TanStack/router/tree/main/examples/react/start-basic-cloudflare

Cloudflare, Alchemy and Vite+ first-party documentation/artifacts:

- [C1] Cloudflare Start guide; [A1] Alchemy Start guide.
- [A2] Alchemy beta.79 metadata/artifact; [A3] Matching frontend-frameworks metadata/artifact.
- [V1] Vite+ build guide; [V2] Vite+ test guide.

[C1]: https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
[A1]: https://alchemy.run/cloudflare/frontend/tanstack-start/
[A2]: https://registry.npmjs.org/alchemy/2.0.0-beta.79
[A3]: https://registry.npmjs.org/@alchemy.run%2ffrontend-frameworks/2.0.0-beta.79
[V1]: https://viteplus.dev/guide/build
[V2]: https://viteplus.dev/guide/test

Published TanStack package metadata (exact versions observed via npm `latest`):

- [P1] Start 1.168.60; [P2] Router 1.170.41; [P3] SSR Query integration 1.167.3; [P4] Query 5.104.1.

[P1]: https://registry.npmjs.org/@tanstack%2freact-start/1.168.60
[P2]: https://registry.npmjs.org/@tanstack%2freact-router/1.170.41
[P3]: https://registry.npmjs.org/@tanstack%2freact-router-ssr-query/1.167.3
[P4]: https://registry.npmjs.org/@tanstack%2freact-query/5.104.1

WordPress/WooCommerce first-party sources (retrieved 2026-10-03; no pilot Woo
version or gateway was supplied):

- [W1] Store API overview; [W2] Public products; [W3] Cart operations; [W4] Cart Tokens; [W5] Store API nonces.
- [W6] Checkout API; [W7] Blocks/payment integration; [W8] Shareable Woo-hosted checkout links.
- [W9] WC REST API overview; [W10] WC REST authentication/orders reference; [W11] Narrow Store API order read.
- [W12] Current order authorization source; [W13] Gateway API; [W14] Categories; [W15] Token session handler (source links use `trunk`, not a pinned Site release).
- [WP1] WordPress REST authentication; [WP2] WordPress nonce security.

[W1]: https://developer.woocommerce.com/docs/apis/store-api/
[W2]: https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/
[W3]: https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/cart/
[W4]: https://developer.woocommerce.com/docs/apis/store-api/cart-tokens/
[W5]: https://developer.woocommerce.com/docs/apis/store-api/nonce-tokens/
[W6]: https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/checkout/
[W7]: https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/checkout-payment-methods/payment-method-integration/
[W8]: https://developer.woocommerce.com/docs/best-practices/urls-and-routing/checkout-urls/
[W9]: https://developer.woocommerce.com/docs/apis/rest-api/
[W10]: https://woocommerce.github.io/woocommerce-rest-api-docs/
[W11]: https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/order/
[W12]: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/src/StoreApi/Utilities/OrderAuthorizationTrait.php
[W13]: https://developer.woocommerce.com/docs/features/payments/payment-gateway-api/
[W14]: https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/product-categories/
[W15]: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/src/StoreApi/SessionHandler.php
[WP1]: https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/
[WP2]: https://developer.wordpress.org/apis/security/nonces/

For exact pinned Alchemy source, metadata [A2] identifies tarball
`https://registry.npmjs.org/alchemy/-/alchemy-2.0.0-beta.79.tgz`
(SHA-512 integrity
`sha512-pn48ye2fenePmhVFkQHPP1zNlpPN/5HzsWerrgKE8N9ljBUJgwgQeL+3QyeWhxGwxttsaSGc/o5JZPppTTL4UQ==`),
containing `package/src/Cloudflare/Website/Vite.ts` and its export in
`package/src/Cloudflare/Website/index.ts`. Metadata [A3] identifies
`https://registry.npmjs.org/@alchemy.run/frontend-frameworks/-/frontend-frameworks-2.0.0-beta.79.tgz`,
containing `package/src/vite/index.ts` and `package/dist/vite/index.js`.
The document's version claims use published artifacts; the moving official
examples/docs establish intended integration, not a local runtime proof.
