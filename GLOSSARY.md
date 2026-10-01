# GETQUICK site blueprint

`getquick-site` holds the blueprint every GETQUICK site follows: the `gq`
CLI, published as `@getquick/site`, and the design and rollout plan behind
it ([ADR 0001](docs/adr/0001-the-getquick-site-blueprint.md)).

## Language

### Blueprint and fleet

**Site**:
One GETQUICK client website: its own repository, Admin, Frontend, and data.
Lombardi and Ekis are sites.
_Avoid_: project (in prose; `project` is the manifest key naming a site)

**Blueprint**:
The shared definition of a site's managed files and conventions.
`getquick-site` (repository), `@getquick/site` (package) and `gq` (command)
are its code names, not separate terms.
_Avoid_: template, base project

**Managed file**:
A file, or a section or set of keys in one, that the blueprint generates.
_Avoid_: generated file (when a section or key set is meant)

**Site-owned file**:
A file the blueprint never overwrites, such as a site's ADRs, research,
plugins, theme and apps.

**Variant**:
The kind of site the blueprint supports: content or commerce. Lombardi is a
content site; Ekis is a commerce site.

**Platform release**:
A tested combination of blueprint, shared packages, GETQUICK plugins,
WordPress, and runtimes.
_Avoid_: blueprint release (that is only one part of it)

**Fleet**:
Every site kept up to date through platform releases.

### Parts of a site

**Admin**:
A site's Bedrock WordPress CMS and WPGraphQL API, deployed to Ploi.
_Avoid_: CMS (except in paths such as `apps/cms`)

**Frontend**:
A site's public website, rendered from the Admin's content and deployed to
Cloudflare Workers.
