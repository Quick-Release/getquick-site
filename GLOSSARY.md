# GETQUICK site blueprint

`gq-site` holds the blueprint every GETQUICK site follows: the `gq`
CLI, published as `@getquick/site`, and the design and rollout plan behind
it ([ADR 0001](docs/adr/0001-the-getquick-site-blueprint.md)).

## Language

### Blueprint and fleet

**Site**:
One GETQUICK client website: its own repository, CMS, Frontend, and data.
Lombardi and Ekis are sites.
_Avoid_: project (in prose; `project` is the manifest key naming a site)

**Blueprint**:
The shared definition of a site's managed files and conventions.
`gq-site` (repository, formerly `getquick-site`), `@getquick/site` (package) and `gq` (command)
are its code names, not separate terms.
_Avoid_: template, base project

**Managed file**:
A file, or a section or set of keys in one, that the blueprint generates.
_Avoid_: generated file (when a section or key set is meant)

**Site-owned file**:
A file the blueprint never overwrites, such as a site's ADRs, research,
plugins, theme and apps.

**App skeleton**:
The files a new site's CMS or Frontend starts from, written once and only
while that app doesn't exist yet; site-owned from then on.
_Avoid_: app template (a template is the blueprint's source for a file)

**Adoption**:
Bringing an existing site onto the blueprint: its first sync takes over the
managed files, its own deploy steps move into deploy extensions, and anything
the generated sections repeat is removed from the site's own content.
_Avoid_: onboarding (that is adding a site to the fleet)

**Deploy extension**:
A site-owned step that the generated CMS deploy runs after activating the
site's plugins, such as activating its theme.
_Avoid_: deploy hook (hooks are the Git hooks)

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

**CMS**:
A site's Bedrock WordPress editorial backend and WPGraphQL API, deployed to
Ploi.

**Frontend**:
A site's public website, rendered from the CMS's content and deployed to
Cloudflare Workers.

### Hosting

**Staging domain**:
`bnq.pt`, the domain GETQUICK owns for temporarily hosting sites'
development and staging copies. A site's staging hosts are always
`<project>-cms.bnq.pt` for the CMS and `<project>-fe.bnq.pt` for the
Frontend, where `<project>` is the client's name (the site's `project` in
`gq.ops.json`).
