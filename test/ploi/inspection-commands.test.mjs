// Ploi inspection commands at the run() seam: configured IDs, overrides,
// missing configuration, and byte-for-byte output from the former gq-ops.
import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureSite, recordingFetch } from "../support/fixture-site.mjs";

const PLOI_TOKEN = { PLOI_API_TOKEN: "ploi-secret" };

const servers = [
  {
    id: 12,
    name: "web-1",
    status: "active",
    ip_address: "203.0.113.10",
    provider: "hetzner",
    region: "fsn1",
  },
  { id: 7, name: "worker", status: "building", ip_address: null, provider: "custom", region: null },
];

const site = {
  id: 34,
  domain: "admin.example.test",
  status: "active",
  system_user: "fixture",
  project_root: "/",
  web_directory: "/apps/cms/web",
  last_deploy_at: "2026-09-30 10:00:00",
};

test("ploi servers list prints the gq-ops table", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(() => ({ data: servers, links: { next: null } }));

  const result = await fixture.run(["ploi", "servers", "list"], { env: PLOI_TOKEN, fetch });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    "ID  NAME    STATUS    IP            PROVIDER  REGION\n" +
      "--  ------  --------  ------------  --------  ------\n" +
      "12  web-1   active    203.0.113.10  hetzner   fsn1  \n" +
      "7   worker  building                custom          \n",
  );
  assert.deepEqual(
    fetch.requests.map(({ method, url, headers }) => [method, url, headers.Authorization]),
    [["GET", "https://ploi.io/api/servers", "Bearer ploi-secret"]],
  );
});

test("ploi site show uses the configured server and site", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(() => ({ data: site }));

  const result = await fixture.run(["ploi", "site", "show"], { env: PLOI_TOKEN, fetch });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    "Id: 34\nDomain: admin.example.test\nStatus: active\nSystem User: fixture\n" +
      "Project Root: /\nWeb Directory: /apps/cms/web\nLast Deploy At: 2026-09-30 10:00:00\n",
  );
  assert.equal(fetch.requests[0].url, "https://ploi.io/api/servers/12/sites/34");
});

test("ploi flags and env override the configured IDs", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(() => ({ data: site }));

  await fixture.run(["ploi", "site", "show", "--site", "99"], {
    env: { ...PLOI_TOKEN, PLOI_SERVER_ID: "55" },
    fetch,
  });

  assert.equal(fetch.requests[0].url, "https://ploi.io/api/servers/55/sites/99");
});

test("a missing Ploi site ID names where to set it", async () => {
  const fixture = await createFixtureSite({
    ops: { schemaVersion: 1, project: "fixture", variant: "content", ploi: { serverId: "12" } },
  });
  const result = await fixture.run(["ploi", "site", "show"], { env: PLOI_TOKEN });
  assert.equal(result.code, 1);
  assert.equal(
    result.stderr,
    "gq: Ploi site ID is required in gq.ops.json, .env, or a CLI flag.\n",
  );
});
