// The run() seam: each test drives `gq` in-process against a fixture site with
// recording fetch/exec fakes and asserts on exit code, output, and the exact
// requests and child processes. Expected tables are byte-for-byte what the
// vendored gq-ops printed, so command output stays unchanged.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };
import {
  createFixtureSite,
  json,
  recordingFetch,
  runGq,
  temporaryDirectory,
} from "./support/fixture-site.mjs";

const PLOI_TOKEN = { PLOI_API_TOKEN: "ploi-secret" };
const CLOUDFLARE_TOKEN = { CLOUDFLARE_API_TOKEN: "cloudflare-secret" };

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

test("--version and -v print the package version without a project", async () => {
  const cwd = await temporaryDirectory();
  for (const flag of ["--version", "-v"]) {
    const result = await runGq([flag], { cwd });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, `${packageJson.version}\n`);
    assert.equal(result.stderr, "");
  }
});

test("--help lists the command groups without a project", async () => {
  const result = await runGq(["--help"], { cwd: await temporaryDirectory() });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^gq operations CLI\n/);
  for (const form of [
    "gq context show",
    "gq sync [--manifest] [--check] [--variant <content|commerce>]",
    "gq ploi api <operation-id>",
    "gq cloudflare dns list",
    "gq version check [version]",
    "gq release push <major|minor|fix> [--no-deploy]",
  ]) {
    assert.ok(result.stdout.includes(form), form);
  }
});

test("rejects unknown commands and options before loading a project", async () => {
  const cwd = await temporaryDirectory();
  for (const [argv, message] of [
    [["ploi", "unknown"], "Unknown command: ploi unknown. Run gq --help."],
    [
      ["cloudflare", "accounts", "list", "extra"],
      "Unknown command: cloudflare accounts list extra",
    ],
    [["context", "show", "--site", "123"], "--site is not valid for context show."],
    [["ploi", "servers", "list", "--bogus"], "Unknown option: --bogus."],
  ]) {
    const result = await runGq(argv, { cwd });
    assert.equal(result.code, 1, argv.join(" "));
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.startsWith(`gq: ${message}`), result.stderr);
  }
});

test("finds gq.ops.json by walking up from a nested directory", async () => {
  const fixture = await createFixtureSite();
  const nested = fixture.path("apps", "frontend", "src");
  await mkdir(nested, { recursive: true });

  const result = await runGq(["context", "show", "--json"], { cwd: nested });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    project: "fixture",
    projectRoot: fixture.root,
    configPath: fixture.path("gq.ops.json"),
    invocationDirectory: nested,
    machineEnvPath: null,
    ploiConfigured: false,
    cloudflareConfigured: false,
  });
});

test("stops discovery at the nearest git repository", async () => {
  const fixture = await createFixtureSite();
  const nestedRepository = fixture.path("vendor", "other");
  await mkdir(join(nestedRepository, ".git"), { recursive: true });

  const result = await runGq(["context", "show"], { cwd: nestedRepository });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /^gq: No gq\.ops\.json found from .*other\. Run inside/);
});

test("--project and --config select a site from elsewhere", async () => {
  const fixture = await createFixtureSite();
  const elsewhere = await temporaryDirectory();

  for (const selector of [
    ["--project", fixture.root],
    ["--config", fixture.path("gq.ops.json")],
  ]) {
    const result = await runGq([...selector, "context", "show", "--json"], { cwd: elsewhere });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).projectRoot, fixture.root);
  }
});

test("a gq.ops.json without a project name is an actionable error", async () => {
  const fixture = await createFixtureSite({
    ops: { schemaVersion: 1, project: " ", variant: "content", ploi: {} },
  });
  const result = await fixture.run(["context", "show"]);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "gq: gq.ops.json is invalid: project must not be empty.\n");
});

test("credentials merge machine, project .env, and env in increasing precedence", async () => {
  const fixture = await createFixtureSite({
    files: {
      "machine/gq/ops.env": "PLOI_API_TOKEN=machine\nCLOUDFLARE_API_TOKEN=machine-only\n",
      ".env": "PLOI_API_TOKEN=project\n",
    },
  });
  const fetch = recordingFetch(() => ({ data: site }));

  const result = await fixture.run(["ploi", "site", "show", "--json"], {
    env: { XDG_CONFIG_HOME: fixture.path("machine"), PLOI_API_TOKEN: "process" },
    fetch,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fetch.requests[0].headers.Authorization, "Bearer process");

  const context = await fixture.run(["context", "show", "--json"], {
    env: { XDG_CONFIG_HOME: fixture.path("machine") },
  });
  assert.deepEqual(JSON.parse(context.stdout), {
    ...JSON.parse(context.stdout),
    machineEnvPath: fixture.path("machine", "gq", "ops.env"),
    ploiConfigured: true,
    cloudflareConfigured: true,
  });
});

test("the machine env file defaults to HOME/.config when XDG_CONFIG_HOME is unset", async () => {
  const fixture = await createFixtureSite({
    files: { "home/.config/gq/ops.env": "PLOI_API_TOKEN=from-home\n" },
  });
  const result = await fixture.run(["context", "show", "--json"], {
    env: { HOME: fixture.path("home") },
  });
  assert.equal(JSON.parse(result.stdout).ploiConfigured, true);
});

test("never reads process.env or process.cwd()", async (t) => {
  const fixture = await createFixtureSite();
  const previous = process.env.PLOI_API_TOKEN;
  process.env.PLOI_API_TOKEN = "leaked-from-process";
  t.after(() => {
    if (previous === undefined) delete process.env.PLOI_API_TOKEN;
    else process.env.PLOI_API_TOKEN = previous;
  });

  const result = await fixture.run(["ploi", "servers", "list"]);

  assert.notEqual(process.cwd(), fixture.root);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "gq: PLOI_API_TOKEN is required.\n");
  assert.equal(result.fetch.requests.length, 0);
});

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
        "User-Agent": `getquick-site/${packageJson.version}`,
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

test("provider errors exit 1 with the provider's message", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(() => json({ message: "Unauthenticated." }, 401));

  const result = await fixture.run(["ploi", "servers", "list"], { env: PLOI_TOKEN, fetch });

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "gq: Unauthenticated.\n");
});

test("cloudflare dns list resolves the zone by name and escapes control characters", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(({ url }) =>
    new URL(url).pathname === "/client/v4/zones"
      ? { success: true, result: [{ id: "zone-1" }], result_info: { total_pages: 1 } }
      : {
          success: true,
          result: [
            {
              id: "r1",
              type: "A",
              name: "example.test",
              content: "203.0.113.10",
              proxied: true,
              ttl: 1,
            },
            {
              id: "r2",
              type: "TXT",
              name: "_x.example.test",
              content: "safe\u001b]8;;x\u0007",
              proxied: false,
              ttl: 300,
            },
          ],
          result_info: { total_pages: 1 },
        },
  );

  const result = await fixture.run(["cloudflare", "dns", "list"], { env: CLOUDFLARE_TOKEN, fetch });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    "ID  TYPE  NAME             CONTENT                PROXIED  TTL\n" +
      "--  ----  ---------------  ---------------------  -------  ---\n" +
      "r1  A     example.test     203.0.113.10           true     1  \n" +
      "r2  TXT   _x.example.test  safe\\u001b]8;;x\\u0007  false    300\n",
  );
  assert.deepEqual(
    fetch.requests.map(({ url, headers }) => [url, headers.Authorization]),
    [
      [
        "https://api.cloudflare.com/client/v4/zones?name=example.test&account.id=account-1&page=1&per_page=50",
        "Bearer cloudflare-secret",
      ],
      [
        "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records?page=1&per_page=50",
        "Bearer cloudflare-secret",
      ],
    ],
  );
});

test("cloudflare zone show refuses an ambiguous zone name", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(() => ({
    success: true,
    result: [{ id: "a" }, { id: "b" }],
    result_info: { total_pages: 1 },
  }));

  const result = await fixture.run(["cloudflare", "zone", "show"], {
    env: CLOUDFLARE_TOKEN,
    fetch,
  });

  assert.equal(result.code, 1);
  assert.equal(
    result.stderr,
    "gq: Expected exactly one matching Cloudflare zone, found 2. Configure cloudflare.zoneId or pass --zone.\n",
  );
});

test("gq-ops commands classified obsolete are gone", async () => {
  const fixture = await createFixtureSite();
  for (const argv of [
    ["credentials", "configure"],
    ["test", "post-deploy"],
    ["github", "actions", "sync"],
  ]) {
    const result = await fixture.run(argv);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, `gq: Unknown command: ${argv.join(" ")}. Run gq --help.\n`);
    assert.equal(result.exec.calls.length, 0);
  }
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

test("run() requires its output streams", async () => {
  const { run } = await import("../src/index.mjs");
  const cwd = await temporaryDirectory();
  await assert.rejects(
    run(["--version"], { cwd, stderr: { write() {} } }),
    /run\(\) requires stdout and stderr/,
  );
});
