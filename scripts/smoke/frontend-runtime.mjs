#!/usr/bin/env node
//
// The durable published content's runtime proof, on a generated content site
// (see frontend-runtime.sh): builds the Frontend with Alchemy's Astro
// Cloudflare build (`buildInChild`, what `pnpm deploy:frontend` runs in its
// build child), serves the built Worker in workerd (Wrangler's local mode)
// with a local D1 publication store and the Frontend's own migrations, and
// drives it against a stub WordPress that it can take down:
//
//   cold store → 503 for the homepage and an entry; unauthenticated refresh →
//   401; gq frontend refresh → homepage and entry with menu, logo and design
//   presets; CMS down → both still served, an uncached entry is a 503 and a
//   failed refresh keeps them; Worker restart and a rebuilt redeploy → still
//   served; CMS back → a cold entry is looked up, a made-up one is a 404, a
//   change, a new publication and a moved entry are refreshed; the Worker's
//   event secret accepts this Site's signed events and refuses another key's;
//   a signed withdrawal is a 404 at once with the CMS down, through a Worker
//   restart, a delayed older publication and a refresh from a CMS that still
//   returns the entry, until a later republication.
//
// Nothing reaches Cloudflare: no account, token or remote resource is used.
//
//   node scripts/smoke/frontend-runtime.mjs <generated site directory>

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildFrontend,
  checker,
  deliverEvent,
  freePort,
  localWorker,
  runGq,
  stopWorker,
  stubCms,
  visit,
  servedEntry as servedEntryWith,
} from "./frontend-runtime-lib.mjs";

const site = resolve(process.argv[2] ?? ".");
const frontend = join(site, "apps/frontend");
const work = mkdtempSync(join(tmpdir(), "gq-frontend-runtime-"));
const token = "runtime-proof-refresh-token-0123456789abcdef";
const eventKey = "runtime-proof-event-signing-key-0123456789ab";

const results = checker();
const { check } = results;

// WordPress, answering the Frontend's queries by name.
const cms = stubCms([["/about/", { id: "page-64", title: "About", content: "We make things." }]]);

const build = (siteUrl) => buildFrontend(frontend, siteUrl, `http://127.0.0.1:${cms.port}/graphql`);
const local = localWorker({
  site,
  work,
  vars: { FRONTEND_REFRESH_TOKEN: token, PUBLICATION_EVENT_SECRET: eventKey },
});

// gq frontend refresh, as an operator runs it.
async function refresh(port, uris = []) {
  const result = await runGq(
    site,
    [
      "frontend",
      "refresh",
      "--url",
      `http://127.0.0.1:${port}`,
      ...uris.flatMap((uri) => ["--uri", uri]),
      "--json",
    ],
    { FRONTEND_REFRESH_TOKEN: token },
  );
  return { code: result.code, report: result.json, stderr: result.stderr };
}

function servedEntry(html, text = "We make things.", menuLabel = cms.menuLabel) {
  return servedEntryWith(html, text, menuLabel);
}

function served(html, heading = cms.heading, menuLabel = cms.menuLabel) {
  return (
    html.includes(heading) &&
    new RegExp(`<a href="/about/"[^>]*>${menuLabel}</a>`).test(html) &&
    html.includes('src="https://media.example/logo.svg"') &&
    html.includes("--wp--preset--color--brand:#c00")
  );
}

let worker;
try {
  await cms.start();
  const port = await freePort();
  const siteUrl = `http://127.0.0.1:${port}`;
  build(siteUrl);
  const migrate = local.migrate();
  check(
    "the Frontend's migrations apply to the local D1 store",
    migrate.status === 0,
    migrate.stderr,
  );

  worker = await local.start(port);

  const cold = await visit(port);
  check("a never-refreshed homepage is a 503", cold.status === 503, `HTTP ${cold.status}`);
  const coldEntry = await visit(port, "/about/");
  check(
    "a never-refreshed Site's entry is a 503",
    coldEntry.status === 503,
    `HTTP ${coldEntry.status}`,
  );

  const anonymous = await fetch(`${siteUrl}/gq/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  check(
    "a refresh without the token is refused",
    anonymous.status === 401,
    `HTTP ${anonymous.status}`,
  );
  check("and the homepage is still not served", (await visit(port)).status === 503);

  const first = await refresh(port);
  check(
    "gq frontend refresh stores the homepage",
    first.code === 0 && first.report?.ready === true,
    JSON.stringify(first.report) + first.stderr,
  );
  const prepared = await visit(port);
  check(
    "the homepage is served with its menu, logo and design presets",
    prepared.status === 200 && served(prepared.html),
    `HTTP ${prepared.status}`,
  );
  const preparedEntry = await visit(port, "/about/");
  check(
    "and so is the published entry",
    first.report?.entries?.["/about/"]?.outcome === "promoted" &&
      preparedEntry.status === 200 &&
      servedEntry(preparedEntry.html),
    `HTTP ${preparedEntry.status}`,
  );

  await cms.stop();
  const outage = await visit(port);
  check(
    "with the CMS down the homepage is still served",
    outage.status === 200 && served(outage.html),
    `HTTP ${outage.status}`,
  );
  const outageEntry = await visit(port, "/about/");
  check(
    "and so is the entry",
    outageEntry.status === 200 && servedEntry(outageEntry.html),
    `HTTP ${outageEntry.status}`,
  );
  const uncached = await visit(port, "/not-stored/");
  check(
    "an entry the store never held is a 503, not a 404",
    uncached.status === 503,
    `HTTP ${uncached.status}`,
  );
  const failed = await refresh(port);
  check(
    "a refresh during the outage fails and keeps it",
    failed.code === 1 && failed.report?.home?.outcome === "kept" && failed.report?.ready === true,
    JSON.stringify(failed.report),
  );
  check("and the homepage is still served", served((await visit(port)).html));

  await stopWorker(worker);
  worker = await local.start(port);
  const restarted = await visit(port);
  check(
    "after a Worker restart, with the CMS still down, it is still served",
    restarted.status === 200 && served(restarted.html),
    `HTTP ${restarted.status}`,
  );
  const restartedEntry = await visit(port, "/about/");
  check(
    "and so is the entry",
    restartedEntry.status === 200 && servedEntry(restartedEntry.html),
    `HTTP ${restartedEntry.status}`,
  );

  await stopWorker(worker);
  await cms.start();
  build(siteUrl);
  await cms.stop();
  worker = await local.start(port);
  const redeployed = await visit(port);
  check(
    "after a rebuilt redeploy, with the CMS still down, it is still served",
    redeployed.status === 200 && served(redeployed.html),
    `HTTP ${redeployed.status}`,
  );

  cms.heading = "Spring at Acme";
  cms.menuLabel = "Contact";
  await cms.start();
  const recovered = await refresh(port);
  const updated = await visit(port);
  check(
    "once the CMS is back, a refresh serves its changes",
    recovered.code === 0 && served(updated.html, "Spring at Acme", "Contact"),
    JSON.stringify(recovered.report),
  );

  cms.entries.set("/contact/", { id: "page-70", title: "Contact", content: "Write to us." });
  const lookedUp = await visit(port, "/contact/");
  check(
    "an entry the store never held is looked up while the CMS is healthy",
    lookedUp.status === 200 && servedEntry(lookedUp.html, "Write to us.", "Contact"),
    `HTTP ${lookedUp.status}`,
  );
  const madeUp = await visit(port, "/made-up/");
  check("a URL WordPress has nothing at is a 404", madeUp.status === 404, `HTTP ${madeUp.status}`);

  cms.entries.set("/news/", { id: "page-80", title: "News", content: "We launched." });
  const about = cms.entries.get("/about/");
  cms.entries.delete("/about/");
  cms.entries.set("/about-us/", { ...about, content: "We make better things." });
  const targeted = await refresh(port, ["/news/", "/about-us/"]);
  await cms.stop();
  const news = await visit(port, "/news/");
  const oldRoute = await visit(port, "/about/");
  const newRoute = await visit(port, "/about-us/");
  check(
    "gq frontend refresh --uri serves a new publication through an outage",
    targeted.code === 0 && news.status === 200 && servedEntry(news.html, "We launched.", "Contact"),
    JSON.stringify(targeted.report) + targeted.stderr,
  );
  check(
    "and a moved entry's old route redirects to its new one",
    oldRoute.status === 301 &&
      oldRoute.location === "/about-us/" &&
      newRoute.status === 200 &&
      servedEntry(newRoute.html, "We make better things.", "Contact"),
    `HTTP ${oldRoute.status} → ${oldRoute.location}, HTTP ${newRoute.status}`,
  );

  // The Worker's event secret is bound at runtime: this Site's signed check
  // event is accepted, one signed with another key isn't.
  const accepted = await runGq(
    site,
    ["frontend", "events", "check", "--url", `http://127.0.0.1:${port}`, "--json"],
    { PUBLICATION_EVENT_SECRET: eventKey },
  );
  check(
    "gq frontend events check: the Worker accepts this Site's signed events",
    accepted.code === 0 && accepted.json?.accepted === true,
    accepted.stdout + accepted.stderr,
  );
  const refused = await runGq(
    site,
    ["frontend", "events", "check", "--url", `http://127.0.0.1:${port}`, "--json"],
    { PUBLICATION_EVENT_SECRET: "another-sites-event-signing-key-0123456789" },
  );
  check(
    "and refuses events signed with another key",
    refused.code === 1 && refused.json?.status === 401,
    refused.stdout + refused.stderr,
  );

  // A withdrawal, as WordPress sends one when /news/ is unpublished, accepted
  // by the built Worker in workerd and its local D1 store.
  const event = (action, occurredAt) => ({
    site: "acme",
    id: randomUUID(),
    action,
    occurredAt,
    entry: { id: "page-80", uri: "/news/" },
  });
  const delayed = event("publish", Date.now() - 60_000);
  if (cms.server?.listening) await cms.stop();
  const withdrawn = await deliverEvent(port, eventKey, event("withdraw", Date.now() - 1000));
  const gone = await visit(port, "/news/");
  check(
    "a signed withdrawal, with the CMS down, makes the entry a 404 at once",
    withdrawn.status === 200 &&
      withdrawn.body?.status === "withdrawn" &&
      gone.status === 404 &&
      !gone.html.includes("We launched.") &&
      gone.cacheControl === "no-cache",
    `${JSON.stringify(withdrawn.body)} HTTP ${gone.status} (${gone.cacheControl})`,
  );
  const kept = await visit(port, "/contact/");
  check(
    "and the other entries are still served",
    kept.status === 200 && kept.html.includes("Write to us."),
    `HTTP ${kept.status}`,
  );

  await stopWorker(worker);
  worker = await local.start(port);
  const stale = await deliverEvent(port, eventKey, delayed);
  const afterRestart = await visit(port, "/news/");
  check(
    "after a Worker restart it is still a 404, and a delayed older publication is superseded",
    stale.status === 200 && stale.body?.status === "superseded" && afterRestart.status === 404,
    `${JSON.stringify(stale.body)} HTTP ${afterRestart.status}`,
  );

  // The CMS (or a cache in front of it) still returns the entry.
  await cms.start();
  const whole = await refresh(port);
  const afterRefresh = await visit(port, "/news/");
  check(
    "a whole-Site refresh from a CMS that still returns it doesn't restore it",
    whole.report?.entries?.["/news/"]?.outcome === "withdrawn" && afterRefresh.status === 404,
    `${JSON.stringify(whole.report?.entries?.["/news/"])} HTTP ${afterRefresh.status}`,
  );

  cms.entries.get("/news/").content = "We launched again.";
  const republished = await deliverEvent(port, eventKey, event("publish", Date.now()));
  await cms.stop();
  const back = await visit(port, "/news/");
  check(
    "a later republication serves it again, through an outage",
    republished.status === 200 &&
      republished.body?.status === "refreshed" &&
      back.status === 200 &&
      servedEntry(back.html, "We launched again.", "Contact"),
    `${JSON.stringify(republished.body)} HTTP ${back.status}`,
  );
} catch (error) {
  console.error(error.message);
  results.failures += 1;
} finally {
  if (worker) await stopWorker(worker);
  if (cms.server?.listening) await cms.stop();
  rmSync(work, { recursive: true, force: true });
}

console.log(
  results.failures === 0
    ? "Runtime proof passed."
    : `Runtime proof failed: ${results.failures} check(s).`,
);
process.exit(results.failures === 0 ? 0 : 1);
