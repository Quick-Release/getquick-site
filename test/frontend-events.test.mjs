// `gq frontend events check` at the run() seam: proves the deployed Frontend
// accepts this Site's publication events by sending a signed check event to
// POST /gq/events. A recording fetch stands in for the Frontend; nothing here
// reaches the network.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createFixtureSite, json, recordingFetch } from "./support/fixture-site.mjs";

const OPS = Object.freeze({
  schemaVersion: 1,
  project: "fixture",
  variant: "content",
  domains: { admin: "admin.example.test", frontend: "www.example.test" },
});

const KEY = "fixture-event-signing-key-0123456789abcdef";

async function check(argv = [], { env = { PUBLICATION_EVENT_SECRET: KEY }, respond } = {}) {
  const fixture = await createFixtureSite({ ops: OPS });
  const fetch = recordingFetch(respond ?? (() => json({ status: "checked", site: "fixture" })));
  return fixture.run(["frontend", "events", "check", ...argv], { env, fetch });
}

test("a check sends a check event for this Site, signed with its event secret", async () => {
  const { code, stdout, fetch } = await check();

  assert.equal(code, 0);
  assert.equal(fetch.requests.length, 1);
  const [request] = fetch.requests;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://www.example.test/gq/events");
  const event = JSON.parse(request.body);
  assert.equal(event.site, "fixture");
  assert.equal(event.action, "check");
  assert.match(event.id, /^[0-9a-f-]{36}$/u);
  const timestamp = request.headers["GQ-Event-Timestamp"];
  assert.ok(Math.abs(Number(timestamp) - Date.now() / 1000) < 60);
  const expected = createHmac("sha256", KEY).update(`${timestamp}.${request.body}`).digest("hex");
  assert.equal(request.headers["GQ-Event-Signature"], `v1=${expected}`);
  assert.ok(!JSON.stringify(request).includes(KEY), "the key itself is never sent");
  assert.match(stdout, /✓ The Frontend at https:\/\/www\.example\.test accepts fixture's/u);
  assert.ok(!stdout.includes(KEY));
});

test("a Frontend that refuses the events is reported, and the check exits 1", async () => {
  const { code, stdout } = await check([], {
    respond: () =>
      json({ error: "Events are disabled: this Frontend has no event secret bound." }, 403),
  });

  assert.equal(code, 1);
  assert.match(stdout, /✗ .* refused fixture's publication events: Events are disabled/u);
});

test("a Frontend that accepts another Site's events doesn't pass", async () => {
  const { code } = await check([], { respond: () => json({ status: "checked", site: "other" }) });

  assert.equal(code, 1);
});

test("without PUBLICATION_EVENT_SECRET nothing is sent", async () => {
  const { code, stderr, fetch } = await check([], { env: {} });

  assert.equal(code, 1);
  assert.match(stderr, /PUBLICATION_EVENT_SECRET is missing/u);
  assert.equal(fetch.requests.length, 0);
});

test("--url checks another Frontend, but never over plain HTTP to another host", async () => {
  const local = await check(["--url", "http://127.0.0.1:8799", "--json"]);
  const remote = await check(["--url", "http://www.example.test"]);

  assert.equal(local.code, 0);
  assert.equal(local.fetch.requests[0].url, "http://127.0.0.1:8799/gq/events");
  assert.deepEqual(JSON.parse(local.stdout), {
    accepted: true,
    status: 200,
    answer: { status: "checked", site: "fixture" },
  });
  assert.equal(remote.code, 1);
  assert.equal(remote.fetch.requests.length, 0);
});
