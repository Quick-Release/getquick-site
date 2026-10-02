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
//   recovers it. delivery-retries.php's scheduler (`wp gq-events retry-due`,
//   on a clock this proof moves on) delivers what the Frontend didn't
//   confirm once its delay passes, without visits or republishing: a
//   publication sent while the Frontend was down, a publication and a
//   setting the Frontend couldn't read back (backing off while it can't), and
//   one whose request was interrupted; it stops after the last attempt, which
//   editors, `wp gq-events delays` and Site Health report, and an overlapping
//   run sends nothing. Last, with the local ddev/ddev-webserver Docker image
//   present, a real cron daemon runs the crontab `gq ploi events` installs.
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
import { retryCrontab } from "../../src/ploi/events.mjs";
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
  for (const plugin of ["publication-events.php", "settings-events.php", "delivery-retries.php"]) {
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
  // The proof's clock: the retry scheduler's "now" is the real time plus an
  // offset this proof sets, so a retry's delay passes without waiting for it.
  writeFileSync(
    join(wordpress, "wp-content/mu-plugins/proof-clock.php"),
    `<?php add_filter('gq_events_now', static fn(int $now): int => $now + (int) get_option('proof_clock_offset', 0));\n`,
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

  // --- Retries: the scheduler `gq ploi events` puts in the server's cron ---
  // `wp gq-events retry-due`, run with no visits and no republishing, sends
  // what the Frontend didn't confirm once its delay has passed.
  const clock = (seconds) => wpOrFail(["option", "update", "proof_clock_offset", String(seconds)]);
  const retryDue = () => wp(["gq-events", "retry-due", "--format=json"], cmsEnv);
  /** A command's JSON table: what a retry-due run sent, none when nothing was due. */
  const sentBy = ({ stdout }) =>
    JSON.parse(stdout.split("\n").find((line) => line.startsWith("[")) ?? "[]");
  const delays = async () => {
    const listed = await wp(["gq-events", "delays", "--format=json"], cmsEnv);
    return { rows: sentBy(listed), stderr: listed.stderr };
  };
  const report = async (post) =>
    JSON.parse(
      await wpOrFail([
        "eval",
        `echo wp_json_encode(GetQuick\\Site\\DeliveryRetries\\entry_report(${post}));`,
      ]),
    );

  cms.entries.get("/launch/").content = "Configured at last.";
  await clock(61);
  const configured = await retryDue();
  const afterConfigured = await recorded(id);
  check(
    "the retry scheduler delivers a publication recorded before the CMS was configured, once it is",
    configured.code === 0 &&
      afterConfigured?.event?.id === unconfigured?.event?.id &&
      afterConfigured?.delivery?.status === "refreshed" &&
      (await visit(port, "/launch/")).html.includes("Configured at last."),
    configured.stdout + configured.stderr + JSON.stringify(afterConfigured?.delivery),
  );
  await clock(0);

  // A dispatch failure: the Frontend is down when the editor publishes.
  const pricing = await wpOrFail(
    [
      "post",
      "create",
      "--post_type=page",
      "--post_status=draft",
      "--post_title=Pricing",
      "--post_name=pricing",
      "--porcelain",
    ],
    cmsEnv,
  );
  cms.entries.set("/pricing/", { id: nodeId(pricing), title: "Pricing", content: "Prices v1." });
  await wpOrFail(["post", "update", pricing, "--post_status=publish"], cmsEnv);
  check(
    "a new page is delivered at once",
    (await recorded(pricing))?.delivery?.status === "refreshed",
  );
  await stopWorker(worker);
  cms.entries.get("/pricing/").content = "Prices v2.";
  await wpOrFail(["post", "update", pricing, "--post_content=Prices v2."], cmsEnv);
  const undelivered = await recorded(pricing);
  const delayedReport = await report(pricing);
  let delayed = await delays();
  check(
    "a publication the Frontend didn't receive is reported to its editor and listed as retrying",
    undelivered?.delivery?.status === "failed" &&
      undelivered.delivery.reason === "network" &&
      delayedReport.state === "retrying" &&
      delayedReport.notice?.type === "warning" &&
      /saved in WordPress, but the public website hasn't been updated yet/u.test(
        delayedReport.notice.message,
      ) &&
      delayed.rows.some(
        (row) => row.subject === `post:${pricing}` && row.state === "retrying" && row.next,
      ),
    JSON.stringify(delayedReport) + JSON.stringify(delayed.rows),
  );

  worker = await local.start(port);
  const early = await retryDue();
  const notYet = await recorded(pricing);
  const meanwhile = await visit(port, "/pricing/");
  check(
    "before its delay has passed, the scheduler leaves it, and visitors keep the last good version",
    early.code === 0 &&
      notYet?.delivery?.attempts === 1 &&
      meanwhile.status === 200 &&
      meanwhile.html.includes("Prices v1."),
    early.stdout + early.stderr + JSON.stringify(notYet?.delivery),
  );
  await clock(61);
  const due = await retryDue();
  const delivered = await recorded(pricing);
  const recoveredReport = await report(pricing);
  await cms.stop();
  const afterScheduled = await visit(port, "/pricing/");
  check(
    "once it is due, the scheduler delivers the same event, without republishing or visits, and the editor sees it recovered",
    due.code === 0 &&
      delivered?.event?.id === undelivered?.event?.id &&
      delivered?.delivery?.status === "refreshed" &&
      delivered.delivery.attempts === 2 &&
      recoveredReport.state === "recovered" &&
      recoveredReport.notice?.type === "success" &&
      afterScheduled.html.includes("Prices v2."),
    due.stdout + due.stderr + JSON.stringify(recoveredReport),
  );
  await clock(0);

  // A refresh failure on the Frontend: the CMS can't be read back, for a
  // publication and a shared setting at once.
  cms.entries.get("/pricing/").content = "Prices v3.";
  await wpOrFail(["post", "update", pricing, "--post_content=Prices v3."], cmsEnv);
  cms.tagline = "Even better things";
  await wpOrFail(["option", "update", "blogdescription", "Even better things"], cmsEnv);
  const unreadPricing = await recorded(pricing);
  const unreadIdentity = await settingsEvent("identity");
  check(
    "a refresh failure records the Frontend's reason, without any secret",
    unreadPricing?.delivery?.reason === "refresh" &&
      /^network: WordPress couldn't be reached/u.test(unreadPricing.delivery.message) &&
      unreadIdentity?.delivery?.reason === "refresh" &&
      !JSON.stringify([unreadPricing, unreadIdentity]).includes(eventKey),
    JSON.stringify([unreadPricing?.delivery, unreadIdentity?.delivery]),
  );
  await clock(61);
  const stillDown = await retryDue();
  // The second attempt's delay (two minutes) hasn't passed.
  const backingOff = await retryDue();
  const afterTwo = [await recorded(pricing), await settingsEvent("identity")];
  pages = await everyPage(port);
  const lastGood = await visit(port, "/pricing/");
  check(
    "while the CMS can't be read, retries fail with a growing delay, and every page keeps its last good version",
    stillDown.code === 0 &&
      sentBy(stillDown).length === 2 &&
      sentBy(backingOff).length === 0 &&
      afterTwo.every((record) => record?.delivery?.attempts === 2) &&
      lastGood.html.includes("Prices v2.") &&
      pages[0].html.includes('<meta name="description" content="Better things">'),
    stillDown.stdout + backingOff.stdout + JSON.stringify(afterTwo.map((r) => r?.delivery)),
  );
  await cms.start();
  await clock(122);
  const restored = await retryDue();
  const afterRestore = [await recorded(pricing), await settingsEvent("identity")];
  await cms.stop();
  pages = await everyPage(port);
  const fresh = await visit(port, "/pricing/");
  check(
    "once the CMS is back, the next due run delivers both, through a later outage",
    restored.code === 0 &&
      afterRestore.every(
        (record) => record?.delivery?.status === "refreshed" && record.delivery.attempts === 3,
      ) &&
      fresh.html.includes("Prices v3.") &&
      pages[0].html.includes('<meta name="description" content="Even better things">'),
    restored.stdout + restored.stderr + JSON.stringify(afterRestore.map((r) => r?.delivery)),
  );
  await cms.start();
  await clock(0);

  // An interrupted request: the event was recorded as pending, but the
  // request ended before sending it.
  const interrupt = (queuedAgo) =>
    wpOrFail([
      "eval",
      `$post = get_post(${pricing});
       GetQuick\\Site\\PublicationEvents\\record($post->ID, GetQuick\\Site\\PublicationEvents\\event_for($post, $post), ['status' => 'pending', 'attempts' => 0, 'queuedAt' => time() - ${queuedAgo}]);`,
    ]);
  cms.entries.get("/pricing/").content = "Prices v4.";
  await interrupt(0);
  const sending = await retryDue();
  const stillPending = await recorded(pricing);
  await interrupt(300);
  const resumed = await retryDue();
  const afterResume = await recorded(pricing);
  check(
    "a pending event is left to its own request for a while, then sent by the scheduler if that request was interrupted",
    sentBy(sending).length === 0 &&
      stillPending?.delivery?.status === "pending" &&
      afterResume?.delivery?.status === "refreshed" &&
      (await visit(port, "/pricing/")).html.includes("Prices v4."),
    sending.stdout + resumed.stdout + JSON.stringify(afterResume?.delivery),
  );

  // A persistent failure: retries stop after the last attempt, and it stays
  // reported until an operator or a newer publication sends it.
  await wpOrFail([
    "eval",
    `$recorded = GetQuick\\Site\\PublicationEvents\\recorded(${pricing});
     GetQuick\\Site\\PublicationEvents\\record(${pricing}, $recorded['event'], ['status' => 'failed', 'reason' => 'refresh', 'message' => 'timeout: WordPress didn\\'t answer within 8 seconds', 'attempts' => 12, 'attemptedAt' => time() - 86000]);`,
  ]);
  const exhausted = await retryDue();
  const failedReport = await report(pricing);
  delayed = await delays();
  const health = JSON.parse(
    await wpOrFail([
      "eval",
      "echo wp_json_encode(GetQuick\\Site\\DeliveryRetries\\site_health());",
    ]),
  );
  check(
    "after its last attempt, a delivery isn't retried again; it is reported as failed to the editor, by delays and in Site Health",
    sentBy(exhausted).length === 0 &&
      (await recorded(pricing))?.delivery?.attempts === 12 &&
      failedReport.state === "failed" &&
      failedReport.notice?.type === "error" &&
      delayed.rows.some((row) => row.subject === `post:${pricing}` && row.state === "failed") &&
      health.status === "critical" &&
      health.description.includes(`post:${pricing}`) &&
      !JSON.stringify(health).includes(eventKey),
    exhausted.stdout + JSON.stringify(failedReport) + JSON.stringify(health),
  );
  const operator = await wp(["gq-events", "retry", pricing], cmsEnv);
  check(
    "an operator's retry delivers it",
    operator.code === 0 && (await recorded(pricing))?.delivery?.status === "refreshed",
    operator.stdout + operator.stderr,
  );

  // Overlapping runs: one holding the lock keeps the other from sending.
  await wpOrFail([
    "option",
    "add",
    "gq_events_retry_lock",
    String(Math.floor(Date.now() / 1000) + 300),
  ]);
  const overlapping = await wp(["gq-events", "retry-due"], cmsEnv);
  await wpOrFail(["option", "delete", "gq_events_retry_lock"]);
  check(
    "a run while another holds the lock sends nothing",
    overlapping.code === 0 && /Another run is sending events/u.test(overlapping.stdout),
    overlapping.stdout + overlapping.stderr,
  );

  const table = await wp(["gq-events", "delays"], cmsEnv);
  check(
    "wp gq-events delays shows when the scheduler last ran",
    /The retry scheduler last ran at/u.test(table.stdout),
    table.stdout + table.stderr,
  );

  // The real scheduler: a cron daemon (Debian's, in the local DDEV web server
  // image, with WP-CLI in /usr/local/bin as on Ploi) runs the exact crontab
  // line `gq ploi events` installs, as an unprivileged user with cron's own
  // environment, against this WordPress. Nothing else sends the event.
  const image = process.env.GQ_SMOKE_CRON_IMAGE ?? "ddev/ddev-webserver:v1.25.4";
  if (spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status !== 0) {
    console.log(`- skipped the real cron: no local Docker image ${image}`);
  } else {
    await clock(0);
    const crontab = retryCrontab({ systemUser: "fixture", domain: "cms.example.test" });
    // The server's .env, which Bedrock defines for cron's runs too.
    await wpOrFail([
      "config",
      "set",
      "GETQUICK_FRONTEND_URL",
      `http://host.docker.internal:${port}`,
    ]);
    await wpOrFail(["config", "set", "PUBLICATION_EVENT_SECRET", eventKey]);
    await stopWorker(worker);
    cms.entries.get("/pricing/").content = "Prices by cron.";
    await wpOrFail(["post", "update", pricing, "--post_content=Prices by cron."]);
    const missed = await recorded(pricing);
    worker = await local.start(port);
    spawnSync("chmod", ["-R", "a+rwX", wordpress]);
    const container = `gq-cron-proof-${process.pid}`;
    const started = spawnSync("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "--add-host",
      "host.docker.internal:host-gateway",
      "--volume",
      `${work}:${work}`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      [
        "useradd --create-home fixture",
        "mkdir -p /home/fixture/cms.example.test/apps",
        `ln -s ${wordpress} /home/fixture/cms.example.test/apps/cms`,
        `printf '%s\\n' '${crontab.frequency} ${crontab.user} ${crontab.command}' > /etc/cron.d/gq-events`,
        "chmod 0644 /etc/cron.d/gq-events",
        "exec cron -f",
      ].join(" && "),
    ]);
    try {
      check("the cron container starts", started.status === 0, String(started.stderr));
      let byCron = missed;
      for (let waited = 0; waited < 200 && byCron?.delivery?.status !== "refreshed"; waited += 5) {
        await new Promise((done) => setTimeout(done, 5000));
        byCron = await recorded(pricing);
      }
      const scheduled = JSON.parse(
        await wpOrFail(["option", "get", "gq_events_scheduler", "--format=json"]),
      );
      check(
        "a real cron running the crontab gq ploi events installs delivers a missed publication, without visits or a retry by hand",
        missed?.delivery?.status === "failed" &&
          byCron?.event?.id === missed.event.id &&
          byCron?.delivery?.status === "refreshed" &&
          byCron.delivery.attempts === 2 &&
          scheduled.ranAt > 0 &&
          (await visit(port, "/pricing/")).html.includes("Prices by cron."),
        `${JSON.stringify(missed?.delivery)} → ${JSON.stringify(byCron?.delivery)}\n${
          spawnSync("docker", ["logs", container]).stderr
        }`,
      );
    } finally {
      spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    }
  }
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
