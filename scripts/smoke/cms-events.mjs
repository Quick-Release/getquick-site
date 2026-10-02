#!/usr/bin/env node
//
// The publication events' real-CMS proof, on a generated content site (see
// cms-events.sh): a real WordPress, on SQLite and driven by WP-CLI, runs the
// site's own web/app/mu-plugins/publication-events.php and
// settings-events.php, and the Frontend,
// built with Alchemy's Astro Cloudflare build and served in workerd with a
// local D1 publication store and its event secret bound, receives the events
// WordPress's own hooks send:
//
//   a draft sends nothing; publishing a page sends a signed event and the
//   Frontend serves it, through a later CMS outage; an update and a rename
//   (its old route redirects) reach visitors the same way; with the Frontend
//   down, publishing still succeeds within its bound and the entry records
//   the failure, `wp gq-events status` lists it and `wp gq-events retry`
//   recovers it once the Frontend is back; a refresh that fails on the
//   Frontend, another key and a missing key in production are recorded as
//   failures and change nothing served; `wp gq-events check` proves the
//   runtime secret on both sides. Shared settings changed through
//   WordPress's own APIs (a menu assigned to the primary location and edited,
//   the site logo, the tagline and site icon, the palette saved through the
//   global-styles REST route GQ Design uses) reach the homepage and the
//   entries through a later outage; a failed settings refresh is recorded,
//   `wp gq-events settings status` lists it and `wp gq-events settings retry`
//   recovers it.
//
// The Frontend reads published content from a stub WordPress that this proof
// keeps in step with what it publishes, since the GETQUICK GraphQL schema
// comes from private packages. Nothing reaches Cloudflare or a live CMS.
//
//   node scripts/smoke/cms-events.mjs <generated site directory> <download cache>

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildFrontend,
  checker,
  freePort,
  localWorker,
  run,
  runGq,
  servedEntry,
  stopWorker,
  stubCms,
  visit,
} from "./frontend-runtime-lib.mjs";

const site = resolve(process.argv[2] ?? ".");
const cache = resolve(process.argv[3] ?? ".");
const version = process.env.WORDPRESS_VERSION;
const work = mkdtempSync(join(tmpdir(), "gq-cms-events-"));
const wordpress = join(work, "wordpress");
const token = "cms-events-proof-refresh-token-0123456789ab";
const eventKey = "cms-events-proof-event-signing-key-0123456";

const results = checker();
const { check } = results;
const cms = stubCms([["/about/", { id: "page-64", title: "About", content: "We make things." }]]);
const nodeId = (id) => Buffer.from(`post:${id}`).toString("base64");

function setUpWordPress() {
  const unzip = (archive, into) => {
    const result = spawnSync("unzip", ["-q", "-o", join(cache, archive), "-d", into]);
    if (result.status !== 0) throw new Error(`unzip ${archive} failed`);
  };
  unzip(`wordpress-${version}.zip`, work);
  const plugins = join(wordpress, "wp-content/plugins");
  unzip("sqlite-database-integration.zip", plugins);
  const sqlite = join(plugins, "sqlite-database-integration");
  writeFileSync(
    join(wordpress, "wp-content/db.php"),
    readFileSync(join(sqlite, "db.copy"), "utf8")
      .replaceAll("{SQLITE_IMPLEMENTATION_FOLDER_PATH}", sqlite)
      .replaceAll("{SQLITE_PLUGIN}", "sqlite-database-integration/load.php"),
  );
  mkdirSync(join(wordpress, "wp-content/mu-plugins"), { recursive: true });
  for (const plugin of ["publication-events.php", "settings-events.php"]) {
    cpSync(
      join(site, "apps/cms/web/app/mu-plugins", plugin),
      join(wordpress, "wp-content/mu-plugins", plugin),
    );
  }
  // The primary menu location GETQUICK's theme registers (getquick-theme's
  // functions.php), which the Frontend's menu is read from.
  writeFileSync(
    join(wordpress, "wp-content/mu-plugins/getquick-theme-locations.php"),
    `<?php add_action('after_setup_theme', static fn() => register_nav_menus(['primary' => 'Primary menu']));\n`,
  );
}

/** WP-CLI on the proof's WordPress, with the CMS's environment added. */
function wp(args, env = {}) {
  return run(
    "php",
    [
      // Errors on stderr, not in the output read back; no deprecation notices
      // from WP-CLI's own dependencies on newer PHP.
      "-d",
      "display_errors=stderr",
      "-d",
      `error_reporting=${32767 & ~8192 & ~16384}`,
      "-d",
      "memory_limit=512M",
      join(cache, "wp-cli.phar"),
      `--path=${wordpress}`,
      ...args,
    ],
    { env: { ...process.env, WP_CLI_CACHE_DIR: join(work, "wp-cli-cache"), ...env } },
  );
}

async function wpOrFail(args, env) {
  const result = await wp(args, env);
  if (result.code !== 0) throw new Error(`wp ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

async function recorded(id) {
  const result = await wp([
    "post",
    "meta",
    "get",
    String(id),
    "_gq_publication_event",
    "--format=json",
  ]);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

async function settingsEvent(setting) {
  const result = await wp(["option", "get", `gq_settings_event_${setting}`, "--format=json"]);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/** Every page visitors get: the homepage and the entry, with the CMS down. */
async function everyPage(port) {
  return Promise.all(["/", "/launch/"].map((path) => visit(port, path)));
}

let worker;
try {
  setUpWordPress();
  await cms.start();
  const port = await freePort();
  const siteUrl = `http://127.0.0.1:${port}`;
  // The CMS's .env, as Ploi's would hold it after `gq ploi events`.
  const cmsEnv = { GETQUICK_FRONTEND_URL: siteUrl, PUBLICATION_EVENT_SECRET: eventKey };

  await wpOrFail([
    "config",
    "create",
    "--dbname=wordpress",
    "--dbuser=wordpress",
    "--dbpass=wordpress",
    "--skip-check",
  ]);
  await wpOrFail([
    "core",
    "install",
    "--url=http://cms.example.test",
    "--title=Acme",
    "--admin_user=editor",
    "--admin_password=editor-password",
    "--admin_email=editor@example.test",
    "--skip-email",
  ]);
  await wpOrFail(["rewrite", "structure", "/%postname%/"]);

  buildFrontend(join(site, "apps/frontend"), siteUrl, `http://127.0.0.1:${cms.port}/graphql`);
  const local = localWorker({
    site,
    work,
    vars: { FRONTEND_REFRESH_TOKEN: token, PUBLICATION_EVENT_SECRET: eventKey },
  });
  const migrate = local.migrate();
  check(
    "the Frontend's migrations apply to the local D1 store",
    migrate.status === 0,
    migrate.stderr,
  );
  worker = await local.start(port);
  const prepared = await runGq(site, ["frontend", "refresh", "--url", siteUrl, "--json"], {
    FRONTEND_REFRESH_TOKEN: token,
  });
  check("the Site is prepared", prepared.code === 0, prepared.stdout + prepared.stderr);

  const checked = await wp(["gq-events", "check"], cmsEnv);
  check(
    "wp gq-events check: the Frontend accepts the CMS's signed events",
    checked.code === 0 && /accepts acme's events/u.test(checked.stdout),
    checked.stdout + checked.stderr,
  );

  const id = await wpOrFail(
    [
      "post",
      "create",
      "--post_type=page",
      "--post_status=draft",
      "--post_title=News",
      "--post_name=news",
      "--post_content=We launched.",
      "--porcelain",
    ],
    cmsEnv,
  );
  check("saving a draft sends no event", (await recorded(id)) === null);

  cms.entries.set("/news/", { id: nodeId(id), title: "News", content: "We launched." });
  await wpOrFail(["post", "update", id, "--post_status=publish"], cmsEnv);
  const published = await recorded(id);
  await cms.stop();
  const news = await visit(port, "/news/");
  check(
    "publishing the page sends a signed event, and the Frontend serves it through a CMS outage",
    published?.delivery?.status === "refreshed" &&
      published.event.entry.uri === "/news/" &&
      published.event.entry.id === nodeId(id) &&
      news.status === 200 &&
      servedEntry(news.html, "We launched.", cms.menuLabel),
    `${JSON.stringify(published)} HTTP ${news.status}`,
  );

  await cms.start();
  cms.entries.get("/news/").content = "We launched today.";
  await wpOrFail(["post", "update", id, "--post_content=We launched today."], cmsEnv);
  await cms.stop();
  const updated = await visit(port, "/news/");
  check(
    "an update reaches visitors without a deploy",
    updated.status === 200 && updated.html.includes("We launched today."),
    `HTTP ${updated.status}`,
  );

  await cms.start();
  cms.entries.set("/launch/", cms.entries.get("/news/"));
  cms.entries.delete("/news/");
  await wpOrFail(["post", "update", id, "--post_name=launch"], cmsEnv);
  const renamed = await recorded(id);
  const oldRoute = await visit(port, "/news/");
  check(
    "a rename sends the route it left, which then redirects",
    renamed?.event?.entry?.previousUri === "/news/" &&
      oldRoute.status === 301 &&
      oldRoute.location === "/launch/",
    `${JSON.stringify(renamed?.event)} HTTP ${oldRoute.status} → ${oldRoute.location}`,
  );

  // Shared settings, changed through WordPress's own APIs.
  cms.menuLabel = "Contact";
  const menu = await wpOrFail(["menu", "create", "Primary", "--porcelain"], cmsEnv);
  await wpOrFail(["menu", "item", "add-custom", menu, "Contact", "/contact/"], cmsEnv);
  const unlocated = await settingsEvent("menus");
  await wpOrFail(["menu", "location", "assign", menu, "primary"], cmsEnv);
  const menus = await settingsEvent("menus");
  await cms.stop();
  let pages = await everyPage(port);
  check(
    "a menu shown nowhere sends nothing; assigning it to the primary location sends a settings event, and every page shows it through an outage",
    unlocated === null &&
      menus?.delivery?.status === "refreshed" &&
      menus.event.setting === "menus" &&
      pages.every(
        ({ status, html }) => status === 200 && /<a href="\/about\/"[^>]*>Contact<\/a>/u.test(html),
      ),
    `${JSON.stringify(menus)} ${pages.map(({ status }) => status)}`,
  );

  await cms.start();
  cms.menuLabel = "Get in touch";
  await wpOrFail(["menu", "item", "add-custom", menu, "Get in touch", "/contact/"], cmsEnv);
  const edited = await settingsEvent("menus");
  await cms.stop();
  pages = await everyPage(port);
  check(
    "editing the primary menu sends a new event, and every page shows it",
    edited?.delivery?.status === "refreshed" &&
      edited.event.id !== menus?.event?.id &&
      pages.every(({ html }) => html.includes("Get in touch")),
    JSON.stringify(edited),
  );

  await cms.start();
  cms.logo = "https://media.example/logo-2026.svg";
  await wpOrFail(["option", "update", "site_logo", "41"], cmsEnv);
  const logo = await settingsEvent("logo");
  await cms.stop();
  pages = await everyPage(port);
  check(
    "changing the site logo sends a settings event, and every page shows it",
    logo?.delivery?.status === "refreshed" &&
      pages.every(({ html }) => html.includes('src="https://media.example/logo-2026.svg"')),
    JSON.stringify(logo),
  );

  await cms.start();
  cms.tagline = "Better things";
  cms.icon = "https://media.example/icon.png";
  await wpOrFail(["option", "update", "blogdescription", "Better things"], cmsEnv);
  await wpOrFail(["option", "update", "site_icon", "42"], cmsEnv);
  const identity = await settingsEvent("identity");
  await cms.stop();
  pages = await everyPage(port);
  check(
    "changing the tagline and the site icon sends identity events: the homepage shows the tagline, every page the icon",
    identity?.delivery?.status === "refreshed" &&
      pages[0].html.includes('<meta name="description" content="Better things">') &&
      pages.every(({ html }) =>
        html.includes('<link rel="icon" href="https://media.example/icon.png">'),
      ),
    JSON.stringify(identity),
  );

  await cms.start();
  cms.color = "#0a0";
  const saved = await wpOrFail(
    [
      "eval",
      `wp_set_current_user(1);
       $id = WP_Theme_JSON_Resolver::get_user_global_styles_post_id();
       $request = new WP_REST_Request('POST', "/wp/v2/global-styles/{$id}");
       $request->set_body_params(['settings' => ['color' => ['palette' => ['theme' => [
         ['slug' => 'brand', 'color' => '#0a0', 'name' => 'Brand'],
       ]]]]]);
       echo rest_do_request($request)->get_status();`,
    ],
    cmsEnv,
  );
  const design = await settingsEvent("design");
  await cms.stop();
  pages = await everyPage(port);
  check(
    "saving the palette through the global-styles REST route sends a design event, and every page uses it",
    saved.endsWith("200") &&
      design?.delivery?.status === "refreshed" &&
      pages.every(
        ({ html }) =>
          html.includes("--wp--preset--color--brand:#0a0") && !html.includes("brand:#c00"),
      ),
    `${saved} ${JSON.stringify(design)}`,
  );

  // The CMS is still down: the Frontend can't read the new menu.
  await wpOrFail(["menu", "item", "add-custom", menu, "Careers", "/careers/"], cmsEnv);
  const unreadMenu = await settingsEvent("menus");
  pages = await everyPage(port);
  const listed = await wp(["gq-events", "settings", "status", "--format=json"], cmsEnv);
  check(
    "a settings refresh that fails on the Frontend is recorded, listed, and every page keeps its menu",
    unreadMenu?.delivery?.status === "failed" &&
      unreadMenu.delivery.reason === "refresh" &&
      unreadMenu.delivery.httpStatus === 503 &&
      pages.every(({ status, html }) => status === 200 && html.includes("Get in touch")) &&
      JSON.parse(listed.stdout || "[]").some(
        (row) => row.setting === "menus" && row.status === "failed",
      ),
    JSON.stringify(unreadMenu?.delivery) + listed.stdout + listed.stderr,
  );

  await cms.start();
  cms.menuLabel = "Careers";
  const retriedSettings = await wp(["gq-events", "settings", "retry", "menus"], cmsEnv);
  const recoveredSettings = await settingsEvent("menus");
  await cms.stop();
  pages = await everyPage(port);
  check(
    "wp gq-events settings retry delivers the same event once the CMS is back",
    retriedSettings.code === 0 &&
      recoveredSettings?.event?.id === unreadMenu?.event?.id &&
      recoveredSettings?.delivery?.status === "refreshed" &&
      recoveredSettings.delivery.attempts === 2 &&
      pages.every(({ html }) => /<a href="\/about\/"[^>]*>Careers<\/a>/u.test(html)),
    retriedSettings.stdout + retriedSettings.stderr + JSON.stringify(recoveredSettings?.delivery),
  );
  await cms.start();

  await stopWorker(worker);
  cms.entries.get("/launch/").content = "Edited while the Frontend was down.";
  const started = Date.now();
  const offline = await wp(["post", "update", id, "--post_content=Edited."], cmsEnv);
  const elapsed = Date.now() - started;
  const status = (await wpOrFail(["post", "get", id, "--field=post_status"])).trim();
  const failed = await recorded(id);
  check(
    "with the Frontend down, publishing still succeeds, within the event's time bound",
    offline.code === 0 && status === "publish" && elapsed < 20_000,
    `exit ${offline.code}, ${status}, ${elapsed} ms: ${offline.stderr}`,
  );
  check(
    "and the entry records the failed delivery for a retry",
    failed?.delivery?.status === "failed" &&
      failed.delivery.reason === "network" &&
      failed.delivery.attempts === 1,
    JSON.stringify(failed?.delivery),
  );
  const pending = await wp(["gq-events", "status", "--format=json"], cmsEnv);
  check(
    "wp gq-events status lists it",
    JSON.parse(pending.stdout || "[]").some(
      (row) => String(row.post) === id && row.status === "failed",
    ),
    pending.stdout + pending.stderr,
  );

  worker = await local.start(port);
  const stale = await visit(port, "/launch/");
  check(
    "meanwhile visitors get the last good publication",
    stale.status === 200 && stale.html.includes("We launched today."),
    `HTTP ${stale.status}`,
  );
  const retried = await wp(["gq-events", "retry", id], cmsEnv);
  const recovered = await visit(port, "/launch/");
  const afterRetry = await recorded(id);
  check(
    "wp gq-events retry delivers the same event once the Frontend is back",
    retried.code === 0 &&
      afterRetry?.event?.id === failed?.event?.id &&
      afterRetry?.delivery?.status === "refreshed" &&
      afterRetry.delivery.attempts === 2 &&
      recovered.html.includes("Edited while the Frontend was down."),
    retried.stdout + retried.stderr + JSON.stringify(afterRetry?.delivery),
  );

  await cms.stop();
  await wpOrFail(["post", "update", id, "--post_title=News (unread)"], cmsEnv);
  const unread = await recorded(id);
  const kept = await visit(port, "/launch/");
  check(
    "a refresh that fails on the Frontend is recorded, and the stored version stays served",
    unread?.delivery?.status === "failed" &&
      unread.delivery.reason === "refresh" &&
      unread.delivery.httpStatus === 503 &&
      kept.status === 200 &&
      kept.html.includes("Edited while the Frontend was down."),
    JSON.stringify(unread?.delivery),
  );
  await cms.start();

  cms.entries.get("/launch/").content = "Injected.";
  await wpOrFail(["post", "update", id, "--post_title=News (other key)"], {
    ...cmsEnv,
    PUBLICATION_EVENT_SECRET: "another-sites-event-signing-key-0123456789",
  });
  const wrongKey = await recorded(id);
  await cms.stop();
  const unchanged = await visit(port, "/launch/");
  check(
    "an event signed with another key is rejected and changes nothing",
    wrongKey?.delivery?.status === "failed" &&
      wrongKey.delivery.reason === "rejected" &&
      wrongKey.delivery.httpStatus === 401 &&
      !unchanged.html.includes("Injected.") &&
      !JSON.stringify(wrongKey).includes("another-sites"),
    JSON.stringify(wrongKey?.delivery),
  );
  await cms.start();

  await wpOrFail(["post", "update", id, "--post_title=News (no key)"], {
    GETQUICK_FRONTEND_URL: siteUrl,
    WP_ENVIRONMENT_TYPE: "production",
  });
  const unconfigured = await recorded(id);
  check(
    "in production without the key, publishing succeeds and records why nothing was sent",
    unconfigured?.delivery?.status === "failed" &&
      unconfigured.delivery.reason === "not-configured",
    JSON.stringify(unconfigured?.delivery),
  );
} catch (error) {
  console.error(error.message);
  results.failures += 1;
} finally {
  await stopWorker(worker);
  if (cms.server?.listening) await cms.stop();
  rmSync(work, { recursive: true, force: true });
}

console.log(
  results.failures === 0
    ? "CMS events proof passed."
    : `CMS events proof failed: ${results.failures} check(s).`,
);
process.exit(results.failures === 0 ? 0 : 1);
