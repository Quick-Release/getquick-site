// `gq frontend refresh` at the run() seam: the trusted refresh of a content
// site's durable homepage. A recording fetch stands in for the deployed
// Frontend's POST /gq/refresh; nothing here reaches the network.
import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureSite, json, recordingFetch } from "./support/fixture-site.mjs";

const OPS = Object.freeze({
  schemaVersion: 1,
  project: "fixture",
  variant: "content",
  domains: { admin: "admin.example.test", frontend: "www.example.test" },
});

const TOKEN = "fixture-refresh-token-0123456789abcdef0123";

const REFRESHED = Object.freeze({
  ready: true,
  refreshed: true,
  home: { outcome: "promoted", state: "published" },
  chrome: { outcome: "promoted", state: "published" },
});

async function refresh(argv = [], { env = { FRONTEND_REFRESH_TOKEN: TOKEN }, respond } = {}) {
  const fixture = await createFixtureSite({ ops: OPS });
  const fetch = recordingFetch(respond ?? (() => json(REFRESHED)));
  return fixture.run(["frontend", "refresh", ...argv], { env, fetch });
}

test("a refresh asks the Frontend, with its token, to promote the homepage", async () => {
  const { code, stdout, fetch } = await refresh();

  assert.equal(code, 0);
  assert.equal(fetch.requests.length, 1);
  const [request] = fetch.requests;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://www.example.test/gq/refresh");
  assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.match(stdout, /✓ front page: promoted \(published\)/u);
  assert.match(stdout, /✓ site chrome: promoted \(published\)/u);
  assert.match(stdout, /^Ready: the homepage is served from the publication store\.$/mu);
  assert.ok(!stdout.includes(TOKEN));
});

test("a refresh that kept stored versions reports why and exits 1", async () => {
  const report = {
    ready: true,
    refreshed: false,
    home: {
      outcome: "kept",
      failure: { reason: "timeout", message: "WordPress didn't answer within 8 seconds" },
    },
    chrome: { outcome: "promoted", state: "published" },
  };
  const { code, stdout } = await refresh([], { respond: () => json(report, 503) });

  assert.equal(code, 1);
  assert.match(
    stdout,
    /✗ front page: kept the stored version \(timeout\): WordPress didn't answer within 8 seconds/u,
  );
  assert.match(stdout, /Ready, but not refreshed/u);
});

test("a Frontend that isn't ready yet exits 1", async () => {
  const report = {
    ready: false,
    refreshed: false,
    home: { outcome: "promoted", state: "published" },
    chrome: { outcome: "kept", failure: { reason: "network", message: "unreachable" } },
  };
  const { code, stdout } = await refresh([], { respond: () => json(report, 503) });

  assert.equal(code, 1);
  assert.match(stdout, /^Not ready: the homepage is a 503/mu);
});

test("a refused refresh is reported without the token", async () => {
  const { code, stdout } = await refresh([], {
    respond: () =>
      json({ error: "A refresh needs this Frontend's refresh token as a bearer token." }, 401),
  });

  assert.equal(code, 1);
  assert.match(stdout, /refused the refresh: A refresh needs this Frontend's refresh token/u);
  assert.ok(!stdout.includes(TOKEN));
});

test("--json prints the Frontend's report", async () => {
  const { code, stdout } = await refresh(["--json"]);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), REFRESHED);
});

test("--url refreshes another Frontend, such as a local runtime", async () => {
  const { code, fetch } = await refresh(["--url", "http://127.0.0.1:8799"]);

  assert.equal(code, 0);
  assert.equal(fetch.requests[0].url, "http://127.0.0.1:8799/gq/refresh");
});

test("the token is never sent over plain HTTP to another host", async () => {
  const { code, stderr, fetch } = await refresh(["--url", "http://www.example.test"]);

  assert.equal(code, 1);
  assert.match(stderr, /only sent over HTTPS \(or to localhost\)/u);
  assert.equal(fetch.requests.length, 0);
});

test("without FRONTEND_REFRESH_TOKEN nothing is sent", async () => {
  const { code, stderr, fetch } = await refresh([], { env: {} });

  assert.equal(code, 1);
  assert.match(stderr, /FRONTEND_REFRESH_TOKEN is missing/u);
  assert.equal(fetch.requests.length, 0);
});
