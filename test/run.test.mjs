// Common run() contracts: routing, site-context discovery, environment
// precedence and isolation, error reporting, and required output streams.
// Provider-specific command behavior lives in the provider's suite folder.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
    "gq sync [--manifest] [--check] [--variant <content|commerce>] [--recreate <path>]...",
    "gq skills update [--check]",
    "gq ploi api <operation-id>",
    "gq cloudflare dns list",
    "gq version check [version]",
    "gq release push <major|minor|fix>",
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

test("provider errors exit 1 with the provider's message", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(() => json({ message: "Unauthenticated." }, 401));

  const result = await fixture.run(["ploi", "servers", "list"], { env: PLOI_TOKEN, fetch });

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "gq: Unauthenticated.\n");
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

test("run() requires its output streams", async () => {
  const { run } = await import("../src/index.mjs");
  const cwd = await temporaryDirectory();
  await assert.rejects(
    run(["--version"], { cwd, stderr: { write() {} } }),
    /run\(\) requires stdout and stderr/,
  );
});
