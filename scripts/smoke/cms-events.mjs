#!/usr/bin/env node
//
// The publication events' real-CMS proof, on a generated content site (see
// cms-events.sh): a real WordPress, on SQLite and driven by WP-CLI, runs the
// site's own web/app/mu-plugins/publication-events.php, and the Frontend,
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
//   runtime secret on both sides; unpublishing, password-protecting,
//   trashing and deleting a page send withdrawals that make it a 404 at once,
//   though the CMS the Frontend reads still returns it and then goes down,
//   and republishing serves it again; a deletion while the Frontend is down
//   is kept for `wp gq-events retry`.
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
  cpSync(
    join(site, "apps/cms/web/app/mu-plugins/publication-events.php"),
    join(wordpress, "wp-content/mu-plugins/publication-events.php"),
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

  // Withdrawals. The stub CMS keeps returning the entry throughout, as a
  // WordPress whose GraphQL a cache still answers for would: only the event
  // can make the Frontend stop serving it.
  cms.entries.get("/launch/").content = "Published again.";
  await wpOrFail(["post", "update", id, "--post_title=News"], cmsEnv);
  check(
    "the entry is served before it is withdrawn",
    (await visit(port, "/launch/")).html.includes("Published again."),
  );

  await wpOrFail(["post", "update", id, "--post_status=draft"], cmsEnv);
  const unpublished = await recorded(id);
  const draft = await visit(port, "/launch/");
  await cms.stop();
  const draftDuringOutage = await visit(port, "/launch/");
  check(
    "unpublishing sends a withdrawal, and the entry is a 404 at once and through a CMS outage",
    unpublished?.event?.action === "withdraw" &&
      unpublished.event.entry.uri === "/launch/" &&
      unpublished.event.entry.id === nodeId(id) &&
      unpublished.delivery?.status === "refreshed" &&
      draft.status === 404 &&
      draftDuringOutage.status === 404 &&
      !draftDuringOutage.html.includes("Published again."),
    `${JSON.stringify(unpublished)} HTTP ${draft.status}, ${draftDuringOutage.status}`,
  );

  await cms.start();
  await wpOrFail(["post", "update", id, "--post_status=publish"], cmsEnv);
  const republished = await visit(port, "/launch/");
  check(
    "republishing serves it again",
    republished.status === 200 && republished.html.includes("Published again."),
    `HTTP ${republished.status}`,
  );

  await wpOrFail(["post", "update", id, "--post_password=members-only"], cmsEnv);
  const protectedEvent = await recorded(id);
  const protectedVisit = await visit(port, "/launch/");
  check(
    "password-protecting it withdraws it",
    protectedEvent?.event?.action === "withdraw" && protectedVisit.status === 404,
    `${JSON.stringify(protectedEvent?.event)} HTTP ${protectedVisit.status}`,
  );
  await wpOrFail(["post", "update", id, "--post_password="], cmsEnv);
  check("removing the password publishes it again", (await visit(port, "/launch/")).status === 200);

  await wpOrFail(["post", "delete", id], cmsEnv);
  const trashed = await recorded(id);
  const trashedVisit = await visit(port, "/launch/");
  check(
    "trashing it sends a withdrawal at the URI it had, and it is a 404",
    trashed?.event?.action === "withdraw" &&
      trashed.event.entry.uri === "/launch/" &&
      trashed.delivery?.status === "refreshed" &&
      trashedVisit.status === 404,
    `${JSON.stringify(trashed)} HTTP ${trashedVisit.status}`,
  );

  // A draft first (no event), so the stub CMS knows its id when it is published.
  const publishPage = async (slug, content) => {
    const page = await wpOrFail(
      [
        "post",
        "create",
        "--post_type=page",
        "--post_status=draft",
        `--post_title=${slug}`,
        `--post_name=${slug}`,
        `--post_content=${content}`,
        "--porcelain",
      ],
      cmsEnv,
    );
    cms.entries.set(`/${slug}/`, { id: nodeId(page), title: slug, content });
    await wpOrFail(["post", "update", page, "--post_status=publish"], cmsEnv);
    return page;
  };
  const deletedOption = async () =>
    JSON.parse(
      (await wp(["option", "get", "gq_publication_events_deleted", "--format=json"])).stdout ||
        "{}",
    );

  const team = await publishPage("team", "Our team.");
  check("a second page is published", (await visit(port, "/team/")).status === 200);
  await wpOrFail(["post", "delete", team, "--force"], cmsEnv);
  const deleted = await visit(port, "/team/");
  check(
    "deleting a published page outright withdraws it, and leaves no record once refreshed",
    deleted.status === 404 && !(team in (await deletedOption())),
    `HTTP ${deleted.status}`,
  );

  const old = await publishPage("old", "Old news.");
  await stopWorker(worker);
  const deletedOffline = await wp(["post", "delete", old, "--force"], cmsEnv);
  const pendingDeletion = (await deletedOption())[old];
  const listed = await wp(["gq-events", "status", "--format=json"], cmsEnv);
  check(
    "with the Frontend down, deleting succeeds and keeps the failed withdrawal for a retry",
    deletedOffline.code === 0 &&
      pendingDeletion?.event?.action === "withdraw" &&
      pendingDeletion.delivery?.status === "failed" &&
      pendingDeletion.delivery.reason === "network" &&
      JSON.parse(listed.stdout || "[]").some((row) => String(row.post) === old),
    JSON.stringify(pendingDeletion) + listed.stdout + listed.stderr,
  );
  worker = await local.start(port);
  const stillServed = await visit(port, "/old/");
  const retriedDeletion = await wp(["gq-events", "retry", old], cmsEnv);
  const withdrawnLater = await visit(port, "/old/");
  check(
    "wp gq-events retry delivers it once the Frontend is back, and the page is a 404",
    stillServed.status === 200 &&
      retriedDeletion.code === 0 &&
      withdrawnLater.status === 404 &&
      !(old in (await deletedOption())),
    `HTTP ${stillServed.status} → ${withdrawnLater.status}: ${retriedDeletion.stdout}${retriedDeletion.stderr}`,
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
