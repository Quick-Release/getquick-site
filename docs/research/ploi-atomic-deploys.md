# Ploi deploys: atomic activation, retained releases and rollback

> Research snapshot: 2026-10-02, for [#21](https://github.com/Quick-Release/getquick-site/issues/21)
> on the [phase 4 map (#18)](https://github.com/Quick-Release/getquick-site/issues/18).
> It feeds [#30, CMS code activation and rollback](https://github.com/Quick-Release/getquick-site/issues/30),
> which owns the decision. This note records options and constraints and does not choose a procedure.
>
> Sources: Ploi's user documentation, API reference and MCP page (undated pages, fetched 2026-10-02),
> Ploi's news posts and staff replies on its public roadmap (dated where shown), and this repository at
> `45d372d`. Also Lombardi at `2c32080` and Ekis at `220e0eb`. Live state comes from **read-only** `GET`
> calls against the Ploi API (site, repository, NGINX configuration, deploy logs). No mutating call was
> made and nothing was deployed. No credentials or customer data are recorded here.
>
> It is a separate file because [`ploi-api.md`](ploi-api.md) is an endpoint inventory that ships with
> the package. That inventory only gets a pointer back to this note, on the two endpoints this note
> relies on.

## Summary

- **Ploi's own zero-downtime deployment (ZTD)** gives us timestamped release folders, a symlink switch,
  3 releases on disk and a rollback button. The **rollback can't be triggered from the API or MCP**,
  shared paths are left to us, and the documentation doesn't say whether it works with our
  repository-less custom deployments. Enabling it also rewrites the deploy script in place, so it
  stops matching what `gq ploi release` syncs.
- **A self-managed release layout inside our own deploy script** works on today's sites, plan and API
  surface. It needs `releases/`, `shared/`, an atomic `current` symlink and rollback via a deploy
  variable on the same `POST …/deploy`. Both sites' NGINX configurations already resolve
  `$realpath_root`, and both dedicated, non-sudo system users can already reload their PHP-FPM pool.
- **Rollback by redeploying an older release** (`gq ploi release --ref <older tag>`) exists today for
  Lombardi, but it isn't atomic: it re-runs `composer install` in place and needs the registry. Ekis's
  git-based script can't target a tag.
- **No option rolls back the database.** Code rollback after `wp core update-db`, plugin migrations or
  deploy extensions is only safe for backward-compatible schema changes, as the rollout plan already
  says.

## Today's deploy, as it actually runs

There are two different scripts. The ticket's "git reset" describes only Ekis.

| | Generated template / Lombardi | Ekis (pre-blueprint) |
|---|---|---|
| Source of code | Release archive on R2. `gq ploi release` packs `git archive` plus a `RELEASE` manifest and passes a presigned `archive_url` deploy variable ([src/ploi/release.mjs](../../src/ploi/release.mjs)) | `git fetch` + `git reset --hard origin/$BRANCH` in the site root ([ekis deploy/ploi/admin.sh](https://github.com/Quick-Release/ekis/blob/220e0eb/deploy/ploi/admin.sh)) |
| Ploi repository | Custom deployments: `provider: none` (live `GET …/repository`). Set by `gq ploi provision` ([src/ploi/provision.mjs](../../src/ploi/provision.mjs)) | GitHub `Quick-Release/ekis@main` (live) |
| Activation | `rsync --delete` of `apps/cms` and `deploy/ploi` **over the live tree**, protecting `.env`, `vendor/`, `web/wp/`, `web/app/uploads/` and the installed plugin, theme and mu-plugin directories. Then `composer install` in place ([template](../../blueprint/templates/deploy/ploi/admin.sh)) | `git reset` in place, then `composer install` in place |
| WordPress steps | `wp maintenance-mode activate` → `composer install` → FPM reload → activate `wordpress.plugins` → check the `getquick-config` mu-plugin loaded → `wp core update-db` → deploy extensions (`admin.d/*.sh`) → `wp rewrite flush` → S3 Uploads one-time copy → maintenance off | Same idea, hand-written. It also runs `wp core install` on the first deploy, locale and translation steps, and a theme-rename migration |
| OPcache | `sudo -n service phpX.Y-fpm reload` | Same |
| Rollback | Redeploy an older ref (`gq ploi release --ref vX`): same in-place path | None scripted. `BRANCH` can name a branch; a tag doesn't work with `origin/$BRANCH` |

The in-place window is the problem. Between the first `rsync`/`git reset` and the end of
`composer install`, the live docroot mixes old and new code. Maintenance mode hides this only for
requests that reach WordPress's bootstrap. A failed `composer install` leaves the mixed tree live.

Live, read-only:

- Both sites have `project_type: ""`, `web_directory: /apps/cms/web`, `project_root: /`,
  `has_repository: true` and `zero_downtime_deployment: false`.
- Both run as dedicated system users (Ekis `ekisadmin-0560d4`, Lombardi `lombardi`), each with its own
  PHP-FPM pool socket (`/run/php/phpX.Y-fpm-<user>.sock`).
- Both NGINX configurations set `fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;` and
  `DOCUMENT_ROOT $realpath_root`.
- Recent full deploys on both sites log `Reloaded phpX.Y-fpm to clear PHP opcache.` So the non-sudo
  system user can `sudo -n` reload its FPM service on these servers. Ekis's user was created
  `sudo: false` ([ploi-user-update.mjs](https://github.com/Quick-Release/ekis/blob/220e0eb/scripts/ploi/ploi-user-update.mjs)),
  and so was Lombardi's (`gq ploi provision` plans "system user … (no sudo)"). The rule that allows the
  reload is Ploi's server configuration, and Ploi's documentation doesn't describe it. Treat it as
  observed, not guaranteed.

## What Ploi offers

### Zero-downtime deployment (ZTD)

- **Layout.** "It will create a folder named '{site_domain}-deploy' and create timestamp based folders
  inside it." "The current version, is linked with a system link to the web directory folder." Source:
  [How does zero downtime deployment work](https://ploi.io/documentation/deployment/how-does-zero-downtime-deployment-work).
  The page doesn't say whether the link replaces the site root or only the web directory. With our
  `web_directory` of `/apps/cms/web`, that has to be checked on a disposable site.
- **Retention: 3 on disk, 5 offered.** The documentation says "The system keeps 3 versions: Oldest,
  Recent, Current" (same page). The 2020 announcement says "we keep track of the latest 5 deployments,
  so you're able to go back 5 deployments in total" ([Testing domains & rolling back deployments](https://ploi.io/news/testing-domains-rolling-back-deployments),
  14 July 2020). A user reports the UI showing 5 rollback buttons with only 3 folders on disk, and the
  item is still "Planned" ([roadmap #300](https://roadmap.ploi.io/projects/1-server-level-requests/items/300-zero-downtime-deployment-history-is-misleading)).
  Retention isn't configurable anywhere in the documentation or API.
- **Shared paths are left to us.** "If you want to hold the storage folder in 1 place, you can create a
  storage folder inside the '{site_domain}-deploy' folder, and symlink this to your current version. It
  is also to possible to leave this as it is, it will just copy all your files." (ZTD page). Nothing
  documents where Ploi's environment editor writes `.env` on a ZTD site, which our script copies from
  the site root into `apps/cms/.env`. That has to be checked.
- **Enabling it.** It's a checkbox under site Settings ([enable ZTD](https://ploi.io/documentation/deployment/how-do-i-enable-zero-downtime-deployment)),
  or `PATCH /api/servers/{server}/sites/{site}` with `zero_downtime_deployment: true`. The API
  reference says it "Requires a repository to be attached to the site, and a subscription plan that
  includes zero downtime deployments. When enabling, your deploy script is automatically rewritten to
  run inside the {RELEASE} directory and the PHP-FPM reload is moved to the post deploy script"
  ([Update site](https://developers.ploi.io/sites/update-site)). The folders only change on the next
  deploy (ZTD page). The original announcement limited ZTD to Pro and Unlimited plans
  ([news, 28 May 2018](https://ploi.io/news/zero-time-deployment)). Our current plan wasn't checked.
- **Pre, main and post deploy scripts.** A Ploi staff member says "pre, main and post deploy scripts
  have been added", and the post script runs after the switch ([roadmap #446](https://roadmap.ploi.io/projects/1-server-level-requests/items/446-post-deployment-commands),
  status Live). The REST API has only one deploy script (`GET`/`PATCH …/deploy/script`;
  [Get](https://developers.ploi.io/deployments/get-deploy-script),
  [Update](https://developers.ploi.io/deployments/update-deploy-script)), and no documented pre or post
  script endpoint.
- **OPcache.** Ploi staff in the same thread: "You don't need to reload PHP FPM … The reload isn't
  needed because the zero downtime feature creates a new folder based on time which tells opcache
  'these files are new'". A user notes this depends on `$realpath_root` in NGINX, which newer sites
  have. Both our sites already do.
- **Rollback.** It's triggered from the panel ("with the click of a button", 2020 news). The REST
  sitemap has **no rollback, release or deployment-list endpoint**
  ([sitemap](https://developers.ploi.io/sitemap.xml): deployments are deploy, deploy-to-production and
  get/update script only). The MCP server lists `list-deployments` and `get-deployment-log` but no
  rollback tool ([MCP](https://developers.ploi.io/getting-started/mcp)). Neither CI nor `gq` could run a
  ZTD rollback.
- **System user changes.** Changing the system user of a ZTD site isn't supported. Turning ZTD off
  first leaves the release folders under the old user ([roadmap #846](https://roadmap.ploi.io/projects/7-bugs/items/846-changing-system-user-on-previously-zero-downtime-deployment-sites-wont-change-move-deployment-data),
  closed, staff reply "ztd moving support is coming soon"). Ekis's `pnpm ploi user update` creates a
  **new** site for the new user rather than changing the user in place, so it isn't affected. But ZTD
  would have to be re-enabled on the replacement site.
- **Custom deployments: unknown.** Ploi's documented ZTD flow is repository-shaped: run the script
  inside `{RELEASE}`, with git, in the examples. Lombardi's site reports `has_repository: true` with
  `provider: none`, so the API precondition may pass. Nothing documents what Ploi puts into a new
  `{RELEASE}` folder for a custom deployment (empty, a copy of the last release, or a clone). This is the
  biggest open question for option A.

### Other relevant API facts

- `POST …/deploy` accepts `variables` that reach the script as uppercased environment variables, and an
  optional `scheduled` time. "A deployment will not be executed if there is no repository installed"
  ([Deploy site](https://developers.ploi.io/deployments/deploy-site)). The deploy webhook takes the same
  variables ([webhook docs](https://ploi.io/documentation/deployment/how-to-use-the-deploy-webhook-url)).
  So any script-implemented rollback can go through the API we already use.
- Ploi's site file backup (Ekis schedules one daily for `/home/<user>/<domain>`, keeping 14; see
  [Ekis README](https://github.com/Quick-Release/ekis/blob/220e0eb/README.md)) would back up whatever
  layout we choose. With release folders it also copies every retained release unless they're
  excluded (the `excluded` field on [Update site file backup](https://developers.ploi.io/site/update-site-file-backup)).
  Whether it follows a `current` symlink is undocumented.

## Options

### A. Ploi ZTD

Atomic switch and OPcache handling come from Ploi, with a UI rollback across 3 retained releases.

Constraints:

- No API or MCP rollback, so the procedure would be "a human clicks in the panel".
- Retention is fixed at 3 on disk, and the UI is misleading about it.
- The plan must include ZTD.
- Behaviour with custom deployments is undocumented (Lombardi and the template). Ekis's git repository
  fits the documented flow.
- Enabling it rewrites the deploy script, which conflicts with `syncDeployScript`. `gq ploi release`
  pushes `deploy/ploi/admin.sh` verbatim and would overwrite Ploi's `{RELEASE}`-based rewrite. The
  generated script would have to be written for ZTD itself (use `$RELEASE`, no FPM reload).
- The post deploy script exists only in the panel, so it can't be managed by `gq`.
- `.env` and uploads sharing is ours to set up and undocumented.
- Our script's `index.html` and `public/` normalization assumes the site root is the code root.

### B. Self-managed releases in the generated `admin.sh`

The script uses the site root (`/home/<user>/<domain>`) as a deploy root:

- `releases/<version>-<sha>/` holds the unpacked archive, a full `composer install` and
  `apps/cms/web/wp`.
- `shared/` holds `.env` and `web/app/uploads`, symlinked into each release.
- `current` is switched with `ln -sfn` on a temporary name and `mv -T`, which is atomic.
- Ploi's `web_directory` becomes `/current/apps/cms/web`.

The script keeps N releases (our choice) and prunes the rest. Rollback re-points `current` at a
retained release, selected by a deploy variable (for example `rollback_to=<release>`) on the same
`POST …/deploy`. That makes it scriptable from `gq` and CI, with no new Ploi feature.

- **Fits:**
  - Custom deployments with release archives. "Build once, promote the same artifact" can extend to
    the installed tree.
  - Dedicated users: everything stays in the user's home.
  - OPcache: `$realpath_root` is already set, and the `sudo -n` FPM reload already works as a
    belt-and-braces step after the switch.
  - Retention is ours to set.
- **Costs:**
  - The script owns pruning, disk use and the first-run migration from the in-place tree. Disk use is
    N × (vendor + WordPress core + plugins); WooCommerce makes Ekis's larger. Sizes weren't measured.
  - Changing `web_directory` is a site setting change. Today `gq ploi provision` handles drift on
    `web_directory` and `project_root`.
  - The release isn't in Ploi's UI history.
- **Unchanged:** `composer install` still runs on the server per release, from `composer.lock`, so no
  new versions are resolved. It runs in the new release folder before the switch, so a failure never
  touches `current`.

### C. Rollback by redeploy (status quo plus a procedure)

`gq ploi release --ref <previous tag>` for Lombardi and the template. Ekis would need tag support.

- Needs no layout change.
- It isn't atomic: it uses the same in-place window and needs R2, the Composer registry and
  `COMPOSER_AUTH` to be available during an incident.
- It's slow: minutes, dominated by `composer install`.
- It re-runs plugin activation, `update-db` and extensions against the newer database.

## Shared paths under any release layout (Bedrock)

| Path | Per release or shared | Why |
|---|---|---|
| Site-root `.env`, written by Ploi's environment editor | **shared** | Server-owned secrets. Today it's copied to `apps/cms/.env` each deploy. Under B, symlink it or keep copying it into the release before the switch |
| `apps/cms/web/app/uploads` | **shared** | Runtime content. Both sites use S3 Uploads on R2 for media, but the directory still exists, and the template's one-time copy reads it |
| `apps/cms/web/app/mu-plugins` | **per release** | Code: `getquick-config` installed by Composer, plus Bedrock's autoloader. The template already checks `GETQUICK_CONFIG_VERSION` after install |
| `apps/cms/vendor`, `web/wp`, `web/app/{plugins,themes}` | **per release** | Composer output for that release's lock file. Sharing them would bring back the in-place window |
| `web/app/cache`, `upgrade` and similar plugin-written runtime directories | check per plugin | Not audited here |
| `.maintenance` (written by `wp maintenance-mode` into `web/wp` of the release WP-CLI runs in) | per release | If maintenance mode is wanted during `update-db`, it has to be turned on in the **live** release, not the staged one |

## Interactions #30 has to settle

- **Order of database steps vs the switch.** Plugin activation, `wp core update-db` and deploy
  extensions change the shared database. If they run before the switch, old code runs on a migrated
  schema. If they run after, there's a short window of new code on the old schema. Rolling back the
  code doesn't undo either. This is the expand/contract rule in the rollout plan's
  [recovery guarantees](../plans/getquick-blueprint-rollout.md#deployment-and-data-recovery-guarantees).
- **Re-running steps on rollback.** Should a rollback re-run plugin activation and extensions?
  `wp plugin activate` of an older set doesn't deactivate plugins the newer release added. Extensions
  are written to run forward.
- **The partial-release marker.** It still comes from the deploy log (`<PROJECT>_DEPLOY_STATUS=… SHA=…`,
  read by `deploy()` in `provision.mjs`). Under option B, a rollback should print the same marker with
  the re-activated SHA so `gq` can confirm it.
- **Ekis's in-place quirks.** The `apps/admin` legacy symlink, `getquick-options` cleanup, `wp core
  install` on the first deploy and `MEDIA_ENV_ONLY`/`COMPOSER_ONLY` modes would all need a decision when
  Ekis adopts the generated script.

## Open checks (each needs a disposable site, not production)

1. With ZTD on a custom-deployment site, what does Ploi put into `{RELEASE}`? Does it accept a
   `deploy_script` PATCH afterwards without re-rewriting it?
2. With ZTD, is the site root or the web directory the symlink? Where does the environment editor
   write `.env`?
3. Does our current plan include ZTD? (Account and plan read, not done.)
4. Release size on disk for Lombardi and Ekis (`du` on a release tree), to size N.
5. Does Ploi's site file backup follow a `current` symlink or the release folders?
