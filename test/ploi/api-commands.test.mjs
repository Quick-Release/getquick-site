// Ploi provider commands through run(): log requests, confirmation, dry-run,
// catalog access, pagination and site-root-relative request bodies.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import packageJson from "../../package.json" with { type: "json" };
import {
  createFixtureSite,
  recordingFetch,
  runGq,
  temporaryDirectory,
} from "../support/fixture-site.mjs";

const PLOI_TOKEN = { PLOI_API_TOKEN: "ploi-secret" };

test("pnpm ploi:log's form reads the site log as JSON", async () => {
  const fixture = await createFixtureSite();
  const log = { data: [{ id: 1, description: "Deployed" }] };
  const fetch = recordingFetch(() => log);

  const result = await fixture.run(["ploi", "api", "sites.log-site", "--per-page", "5"], {
    env: PLOI_TOKEN,
    fetch,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `${JSON.stringify(log, null, 2)}\n`);
  assert.deepEqual(
    fetch.requests.map(({ method, url }) => [method, url]),
    [["GET", "https://ploi.io/api/servers/12/sites/34/log?per_page=5"]],
  );
});

test("ploi api refuses a mutation without --yes and sends nothing", async () => {
  const fixture = await createFixtureSite();
  const argv = ["ploi", "api", "sites.update-site", "--data", '{"web_directory":"/dist"}'];

  const refused = await fixture.run(argv, { env: PLOI_TOKEN });
  assert.equal(refused.code, 1);
  assert.equal(
    refused.stderr,
    "gq: sites.update-site changes remote state. Re-run with --yes or inspect it with --dry-run.\n",
  );
  assert.equal(refused.fetch.requests.length, 0);

  const fetch = recordingFetch(() => ({ data: { id: 34 } }));
  const confirmed = await fixture.run([...argv, "--yes"], { env: PLOI_TOKEN, fetch });
  assert.equal(confirmed.code, 0, confirmed.stderr);
  assert.deepEqual(fetch.requests, [
    {
      method: "PATCH",
      url: "https://ploi.io/api/servers/12/sites/34",
      headers: {
        Authorization: "Bearer ploi-secret",
        Accept: "application/json",
        "User-Agent": `gq-site/${packageJson.version}`,
        "Content-Type": "application/json",
      },
      body: '{"web_directory":"/dist"}',
    },
  ]);
});

test("ploi api --dry-run prints the request instead of sending it", async () => {
  const fixture = await createFixtureSite({
    files: { "requests/deploy.json": '{"branch":"main"}\n' },
  });

  const result = await fixture.run(
    ["ploi", "api", "sites.update-site", "--data-file", "requests/deploy.json", "--dry-run"],
    { env: PLOI_TOKEN },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    operation: "sites.update-site",
    method: "PATCH",
    url: "https://ploi.io/api/servers/12/sites/34",
    body: { branch: "main" },
  });
  assert.equal(result.fetch.requests.length, 0);
});

test("ploi api list and describe need no project or token", async () => {
  const cwd = await temporaryDirectory();

  const described = await runGq(["ploi", "api", "describe", "servers.list-servers", "--json"], {
    cwd,
  });
  assert.equal(described.code, 0, described.stderr);
  assert.deepEqual(JSON.parse(described.stdout), {
    id: "servers.list-servers",
    method: "GET",
    path: "/api/servers",
    sourceUrl: "https://developers.ploi.io/servers/list-servers",
    summary: JSON.parse(described.stdout).summary,
    pathParameters: "",
    mutationRequiresConfirmation: false,
  });

  const listed = await runGq(["ploi", "api", "list", "--group", "aliases", "--json"], { cwd });
  assert.deepEqual(
    JSON.parse(listed.stdout).map(({ id }) => id),
    ["aliases.create-alias", "aliases.delete-alias", "aliases.list-aliases"],
  );
});

test("ploi api --all follows pagination within the API", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(({ url }) =>
    new URL(url).searchParams.get("page") === "2"
      ? { data: [{ id: 2 }], links: { next: null } }
      : { data: [{ id: 1 }], links: { next: "https://ploi.io/api/servers?page=2" } },
  );

  const result = await fixture.run(["ploi", "api", "servers.list-servers", "--all"], {
    env: PLOI_TOKEN,
    fetch,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(
    fetch.requests.map(({ url }) => url),
    ["https://ploi.io/api/servers", "https://ploi.io/api/servers?page=2"],
  );
});

test("--data-file resolves against the site root, not the invocation directory", async () => {
  const fixture = await createFixtureSite();
  await writeFile(fixture.path("body.json"), '{"a":1}');
  const nested = fixture.path("apps");
  await mkdir(nested);

  const result = await runGq(
    ["ploi", "api", "sites.update-site", "--data-file", "body.json", "--dry-run"],
    { cwd: nested, env: PLOI_TOKEN },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).body, { a: 1 });
});
