#!/usr/bin/env node
//
// The durable homepage's runtime proof, on a generated content site (see
// frontend-runtime.sh): builds the Frontend with Alchemy's Astro Cloudflare
// build (`buildInChild`, what `pnpm deploy:frontend` runs in its build child),
// serves the built Worker in workerd (Wrangler's local mode) with a local D1
// publication store and the Frontend's own migrations, and drives it against
// a stub WordPress that it can take down:
//
//   cold store → 503; unauthenticated refresh → 401; gq frontend refresh →
//   homepage with menu, logo and design presets; CMS down → still served, and
//   a failed refresh keeps it; Worker restart and a rebuilt redeploy → still
//   served; CMS back with a change → the refresh shows it.
//
// Nothing reaches Cloudflare: no account, token or remote resource is used.
//
//   node scripts/smoke/frontend-runtime.mjs <generated site directory>

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const site = resolve(process.argv[2] ?? ".");
const frontend = join(site, "apps/frontend");
const wrangler = join(site, "infra/ci/node_modules/.bin/wrangler");
const gq = fileURLToPath(new URL("../../bin/gq.mjs", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "gq-frontend-runtime-"));
const token = "runtime-proof-refresh-token-0123456789abcdef";

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "✓" : "✗"} ${label}${condition || !detail ? "" : `: ${detail}`}`);
  if (!condition) failures += 1;
}

// WordPress, answering the Frontend's queries by name.
const cms = {
  heading: "Welcome to Acme",
  menuLabel: "About us",
  server: null,
  port: 0,
  start() {
    this.server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const name = /query (\w+)/.exec(JSON.parse(body).query)?.[1];
        const data = {
          HomePage: {
            generalSettings: { title: "Acme", description: "Things" },
            nodeByUri: {
              __typename: "Page",
              isFrontPage: true,
              title: "Home",
              content: `<h1 class="has-brand-color">${this.heading}</h1>`,
            },
            designTokens: { colors: [{ slug: "brand", color: "#c00" }], spacingSizes: [] },
          },
          SiteChrome: {
            generalSettings: {
              siteIcon: null,
              siteLogo: { node: { sourceUrl: "https://media.example/logo.svg", altText: "Acme" } },
            },
            menuItems: {
              nodes: [
                { id: "a", parentId: null, label: this.menuLabel, url: "/about/", target: null },
              ],
            },
          },
        }[name];
        response.writeHead(data ? 200 : 400, { "content-type": "application/json" });
        response.end(JSON.stringify(data ? { data } : { errors: [{ message: "unknown query" }] }));
      });
    });
    return new Promise((done) => this.server.listen(this.port, "127.0.0.1", done)).then(() => {
      this.port = this.server.address().port;
    });
  },
  stop() {
    this.server.closeAllConnections();
    return new Promise((done) => this.server.close(done));
  },
};

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

// Alchemy's Astro build, in apps/frontend so its dependencies resolve.
function build(siteUrl) {
  const script = `
    import { buildInChild } from "@alchemy.run/frontend-frameworks/astro/source";
    import * as Effect from "effect/Effect";
    import * as NodeServices from "@effect/platform-node/NodeServices";
    await Effect.runPromise(buildInChild({
      rootDir: process.cwd(), compatibilityDate: "2026-03-10", compatibilityFlags: ["nodejs_compat"],
      env: {}, sessionKVBindingName: false, sessions: undefined, sessionDevKV: undefined,
      prerenderEnvironment: undefined, astro: { output: "server", site: ${JSON.stringify(siteUrl)} },
      config: undefined,
    }).pipe(Effect.provide(NodeServices.layer)));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: frontend,
    env: {
      ...process.env,
      PUBLIC_WORDPRESS_GRAPHQL_URL: `http://127.0.0.1:${cms.port}/graphql`,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`The Alchemy Astro build failed:\n${result.stderr}`);
}

function writeWranglerConfig() {
  const config = {
    name: "acme-fe-runtime-proof",
    main: join(frontend, "dist/server/entry.mjs"),
    compatibility_date: "2026-03-10",
    compatibility_flags: ["nodejs_compat"],
    no_bundle: true,
    find_additional_modules: true,
    rules: [{ type: "ESModule", globs: ["**/*.mjs"] }],
    assets: { directory: join(frontend, "dist/client"), binding: "ASSETS" },
    d1_databases: [
      {
        binding: "PUBLICATION_DB",
        database_name: "acme-fe-publications",
        database_id: "00000000-0000-0000-0000-000000000000",
        migrations_dir: join(frontend, "migrations"),
      },
    ],
  };
  const path = join(work, "wrangler.json");
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

const persist = join(work, "state");

async function startWorker(config, port) {
  const child = spawn(
    wrangler,
    [
      "dev",
      "--config",
      config,
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      persist,
      "--var",
      `FRONTEND_REFRESH_TOKEN:${token}`,
      "--show-interactive-dev-session=false",
    ],
    { env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/robots.txt`);
      return child;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  child.kill();
  throw new Error(`The Worker didn't start:\n${output}`);
}

async function stopWorker(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  await exited;
}

async function visit(port) {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  return { status: response.status, html: await response.text() };
}

// gq frontend refresh, as an operator runs it. Asynchronous: the stub CMS
// answers the Worker from this process.
function refresh(port) {
  const child = spawn(
    process.execPath,
    [gq, "frontend", "refresh", "--url", `http://127.0.0.1:${port}`, "--json"],
    { cwd: site, env: { ...process.env, FRONTEND_REFRESH_TOKEN: token } },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((done) =>
    child.on("exit", (code) => {
      let report;
      try {
        report = JSON.parse(stdout);
      } catch {
        report = null;
      }
      done({ code, report, stderr });
    }),
  );
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
  const config = writeWranglerConfig();
  // In production Alchemy applies the migrations on deploy; here Wrangler
  // applies the same files to the local store the Worker is served with.
  const migrate = spawnSync(
    wrangler,
    [
      "d1",
      "migrations",
      "apply",
      "PUBLICATION_DB",
      "--local",
      "--persist-to",
      persist,
      "--config",
      config,
    ],
    {
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
      encoding: "utf8",
      input: "",
    },
  );
  check(
    "the Frontend's migrations apply to the local D1 store",
    migrate.status === 0,
    migrate.stderr,
  );

  worker = await startWorker(config, port);

  const cold = await visit(port);
  check("a never-refreshed homepage is a 503", cold.status === 503, `HTTP ${cold.status}`);

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

  await cms.stop();
  const outage = await visit(port);
  check(
    "with the CMS down the homepage is still served",
    outage.status === 200 && served(outage.html),
    `HTTP ${outage.status}`,
  );
  const failed = await refresh(port);
  check(
    "a refresh during the outage fails and keeps it",
    failed.code === 1 && failed.report?.home?.outcome === "kept" && failed.report?.ready === true,
    JSON.stringify(failed.report),
  );
  check("and the homepage is still served", served((await visit(port)).html));

  await stopWorker(worker);
  worker = await startWorker(config, port);
  const restarted = await visit(port);
  check(
    "after a Worker restart, with the CMS still down, it is still served",
    restarted.status === 200 && served(restarted.html),
    `HTTP ${restarted.status}`,
  );

  await stopWorker(worker);
  await cms.start();
  build(siteUrl);
  await cms.stop();
  worker = await startWorker(config, port);
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
} catch (error) {
  console.error(error.message);
  failures += 1;
} finally {
  if (worker) await stopWorker(worker);
  if (cms.server?.listening) await cms.stop();
  rmSync(work, { recursive: true, force: true });
}

console.log(
  failures === 0 ? "Runtime proof passed." : `Runtime proof failed: ${failures} check(s).`,
);
process.exit(failures === 0 ? 0 : 1);
