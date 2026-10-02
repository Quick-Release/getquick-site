// gq setup, gq doctor and gq verify: the shared workspace runners, driven
// through run() against a content fixture site (the content variant's checks
// and required files), with a recording exec standing in for sh,
// node, pnpm, git, ddev, composer and sigillo.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { VERSION } from "../../src/version.mjs";
import { createFixtureSite, recordingExec } from "../support/fixture-site.mjs";
import { CONTENT_CHECKS } from "../support/site-settings.mjs";

const LOCAL_CHECKS = CONTENT_CHECKS.filter((line) => !line.startsWith("composer "));

const OPS = {
  schemaVersion: 1,
  project: "fixture",
  variant: "content",
  sigillo: {
    apiUrl: "https://secrets.example.test",
    projectId: "PROJECT1",
    environments: { local: "dev" },
  },
  cloudflare: { accountId: "account-1" },
  artifacts: { namespace: "fixture-ns", repo: "fixture" },
};

const ARTIFACTS_REMOTE = "https://account-1.artifacts.cloudflare.net/git/fixture-ns/fixture.git";
const GITHUB_REMOTE = "git@github.com:example/fixture.git";

const MANIFEST = {
  name: "fixture",
  private: true,
  devDependencies: { "@getquick/site": VERSION },
  engines: { node: ">=22.12.0" },
  packageManager: "pnpm@12.6.0",
};

// `overrides` replaces files; null leaves one out.
function siteFiles(overrides = {}) {
  const files = {
    "package.json": JSON.stringify(MANIFEST),
    ".mise.toml": '[tools]\nnode = "24.21.0"\n',
    "apps/cms/composer.json": "{}",
    "apps/cms/.ddev/config.yaml": "name: fixture-admin\ntype: wordpress\n",
    "apps/cms/.env.example": "WP_ENV='local'\n",
    "apps/frontend/package.json": "{}",
    "apps/frontend/astro.config.mjs": "export default {};\n",
    "apps/frontend/.env.example": "PUBLIC_GRAPHQL_URL=''\n",
    ...overrides,
  };
  return Object.fromEntries(Object.entries(files).filter(([, content]) => content !== null));
}

async function site({ ops = OPS, files = {} } = {}) {
  return createFixtureSite({ ops, files: siteFiles(files) });
}

// A machine with every tool, a running DDEV project and a logged-in Sigillo,
// unless told otherwise. `installed` names what `command -v` finds; `codes`
// maps a command line (sigillo by its basename) to its exit code; `stdout`
// to its output.
function machine({
  installed = ["pnpm", "git", "ddev", "composer"],
  node = "v24.21.0",
  pnpm = "12.6.0",
  ddev = "running",
  pushUrls = [GITHUB_REMOTE],
  codes = {},
  stdout = {},
} = {}) {
  const outputs = {
    "node --version": `${node}\n`,
    "pnpm --version": `${pnpm}\n`,
    "git --version": "git version 2.50.0\n",
    "git remote get-url --push --all origin": `${pushUrls.join("\n")}\n`,
    ...stdout,
  };
  return recordingExec((call) => {
    if (isLookup(call)) return { code: installed.includes(call.args.at(-1)) ? 0 : 1 };
    const line = commandLine(call);
    if (line === "ddev describe -j") {
      return ddev ? { stdout: JSON.stringify({ raw: { status: ddev } }) } : { code: 1 };
    }
    return { code: codes[line] ?? 0, stdout: outputs[line] ?? "" };
  });
}

function isLookup({ command, args }) {
  return command === "sh" && args[1]?.startsWith("command -v");
}

function commandLine({ command, args }) {
  return [basename(command) === "sigillo" ? "sigillo" : command, ...args].join(" ");
}

// The calls that do something: everything except `command -v` lookups.
const actions = (exec) => exec.calls.filter((call) => !isLookup(call)).map(commandLine);

// --- gq verify ---------------------------------------------------------------

test("gq verify runs the site's checks in order, in the site root, on the terminal", async () => {
  const fixture = await site({ files: { "apps/cms/vendor/autoload.php": "" } });
  const exec = machine();
  const result = await fixture.run(["verify"], {
    cwd: fixture.path("apps/cms"),
    env: { A: "1" },
    exec,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(actions(exec), CONTENT_CHECKS);
  const checks = exec.calls.filter((call) => !isLookup(call));
  const options = exec.options.filter((_, index) => !isLookup(exec.calls[index]));
  for (const [index, call] of checks.entries()) {
    assert.equal(call.cwd, fixture.root);
    assert.equal(call.env.A, "1");
    // The caller installed dependencies; no `pnpm run` re-verifies them.
    assert.equal(call.env.pnpm_config_verify_deps_before_run, "false");
    assert.equal(options[index].stdio, "inherit");
  }
  assert.match(result.stdout, /✓ pnpm run check \(\d+\.\ds\)/u);
  assert.match(result.stdout, /All 9 checks passed in \d+\.\ds\./u);
  assert.equal(result.stderr, "");
});

test("gq verify stops at the first failing check with its exit code", async () => {
  const fixture = await site();
  const exec = machine({ codes: { "pnpm run check": 3 } });
  const result = await fixture.run(["verify", "--ci"], { exec });
  assert.equal(result.code, 3);
  assert.deepEqual(actions(exec), ["pnpm run check"]);
  assert.match(result.stderr, /✗ pnpm run check failed/u);
  assert.doesNotMatch(result.stdout, /checks passed/u);
});

test("gq verify skips (and reports) the Composer checks locally without PHP", async () => {
  for (const [label, installed, files] of [
    ["no Composer", ["pnpm"], { "apps/cms/vendor/autoload.php": "" }],
    ["no apps/cms/vendor", ["pnpm", "composer"], {}],
  ]) {
    const fixture = await site({ files });
    const exec = machine({ installed });
    const result = await fixture.run(["verify"], { exec });
    assert.equal(result.code, 0, `${label}: ${result.stderr}`);
    assert.deepEqual(actions(exec), LOCAL_CHECKS, label);
    assert.match(
      result.stderr,
      /⚠ skipped composer --working-dir=apps\/cms validate — install Composer and run: pnpm cms:composer/u,
      label,
    );
    assert.match(result.stdout, /All 6 checks passed in \d+\.\ds \(3 skipped\)\./u, label);
  }
});

test("gq verify --ci runs every check, PHP or not, without looking for Composer", async () => {
  const fixture = await site();
  const exec = machine({ installed: [] });
  const result = await fixture.run(["verify", "--ci"], { exec });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(exec.calls.filter(isLookup).length, 0);
  assert.deepEqual(actions(exec), CONTENT_CHECKS);
  assert.match(result.stdout, /All 9 checks passed/u);
});

test("gq verify honours the requirements a site declares on its checks", async () => {
  // A commerce site has no default checks: these are all it runs.
  const ops = {
    ...OPS,
    variant: "commerce",
    verify: {
      checks: [
        { cmd: "pnpm", args: ["run", "test"] },
        { cmd: "pnpm", args: ["run", "cms:test"], requires: ["php"] },
        { cmd: "pnpm", args: ["run", "e2e"], requires: ["ddev"] },
        { cmd: "composer", args: ["audit"], requires: [] },
      ],
    },
  };

  const stopped = await site({ ops });
  const withoutDdev = machine({ installed: ["pnpm", "ddev"], ddev: "stopped" });
  const skipped = await stopped.run(["verify"], { exec: withoutDdev });
  assert.equal(skipped.code, 0, skipped.stderr);
  assert.deepEqual(
    actions(withoutDdev).filter((line) => !line.startsWith("ddev")),
    ["pnpm run test", "composer audit"],
  );
  assert.match(skipped.stderr, /⚠ skipped pnpm run cms:test — install Composer/u);
  assert.match(skipped.stderr, /⚠ skipped pnpm run e2e — start DDEV: pnpm cms:dev/u);

  const running = await site({ ops, files: { "apps/cms/vendor/autoload.php": "" } });
  const everything = machine();
  const all = await running.run(["verify"], { exec: everything });
  assert.equal(all.code, 0, all.stderr);
  assert.deepEqual(
    actions(everything).filter((line) => !line.startsWith("ddev")),
    ["pnpm run test", "pnpm run cms:test", "pnpm run e2e", "composer audit"],
  );
});

test("gq verify refuses a check requirement it doesn't know", async () => {
  const fixture = await site({
    ops: { ...OPS, verify: { checks: [{ cmd: "pnpm", args: ["x"], requires: ["docker"] }] } },
  });
  const exec = machine();
  const result = await fixture.run(["verify"], { exec });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /verify\.checks\[0\]\.requires\[0\] must be "php" or "ddev"/u);
  assert.deepEqual(actions(exec), []);
});

test("gq verify takes its own options only", async () => {
  const fixture = await site();
  const unknown = await fixture.run(["verify", "--fast"], { exec: machine() });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Usage: gq verify \[--ci\]/u);
});

// --- gq doctor ---------------------------------------------------------------

async function healthySite(files = {}) {
  const fixture = await site({
    files: {
      "apps/cms/vendor/autoload.php": "",
      "apps/cms/.env": "",
      "apps/frontend/.env": "",
      "node_modules/.bin/sigillo": "",
      ...files,
    },
  });
  return fixture;
}

test("gq doctor reports the toolchain pins, the gq version and a healthy site", async () => {
  const fixture = await healthySite();
  const exec = machine();
  const result = await fixture.run(["doctor"], { exec });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /^Fixture workspace doctor/u);
  assert.match(
    result.stdout,
    new RegExp(`✓ @getquick/site ${VERSION.replaceAll(".", "\\.")}`, "u"),
  );
  assert.match(result.stdout, /✓ Node\.js 24\.21\.0 \(matches the \.mise\.toml pin\)/u);
  assert.match(result.stdout, /✓ pnpm 12\.6\.0 \(matches the packageManager pin\)/u);
  assert.match(result.stdout, /✓ git git version 2\.50\.0/u);
  assert.match(result.stdout, /✓ apps\/cms Composer dependencies installed/u);
  assert.match(result.stdout, /✓ origin pushes to GitHub only/u);
  assert.match(result.stdout, /✓ Sigillo project PROJECT1/u);
  assert.match(result.stdout, /✓ Sigillo is logged in/u);
  assert.match(result.stdout, /✓ DDEV is running for fixture-admin/u);
  assert.match(result.stdout, /All required checks passed\./u);
  assert.doesNotMatch(result.stdout, /[⚠✗]/u);
  assert.ok(actions(exec).includes("sigillo me --api-url https://secrets.example.test"));
});

test("gq doctor fails when Node is below the site's engines minimum", async () => {
  const fixture = await healthySite();
  const result = await fixture.run(["doctor"], { exec: machine({ node: "v20.11.0" }) });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /✗ Node\.js 20\.11\.0 found; Fixture needs >= 22\.12\.0/u);
  assert.match(result.stdout, /Some required checks need attention\./u);
});

test("gq doctor fails when a file the site requires is missing", async () => {
  const fixture = await healthySite({ "apps/frontend/astro.config.mjs": null });
  const result = await fixture.run(["doctor"], { exec: machine() });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /✗ apps\/frontend\/astro\.config\.mjs is missing/u);
});

test("gq doctor fails without node_modules", async () => {
  const fixture = await site();
  const result = await fixture.run(["doctor"], { exec: machine() });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /✗ node_modules is missing — run: pnpm run setup --no-ddev/u);
});

test("gq doctor warns, without failing, about drift from the pins", async () => {
  const fixture = await healthySite({
    "package.json": JSON.stringify({
      ...MANIFEST,
      devDependencies: { "@getquick/site": "0.0.1" },
    }),
  });
  const result = await fixture.run(["doctor"], {
    exec: machine({ node: "v24.1.0", pnpm: "11.0.0", pushUrls: [GITHUB_REMOTE, ARTIFACTS_REMOTE] }),
  });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /⚠ @getquick\/site .+ is running, but package\.json pins 0\.0\.1/u);
  assert.match(result.stdout, /⚠ Node\.js 24\.1\.0 is running but \.mise\.toml pins 24\.21\.0/u);
  assert.match(result.stdout, /⚠ pnpm 11\.0\.0 is running but package\.json pins 12\.6\.0/u);
  assert.match(result.stdout, /⚠ origin still pushes to Cloudflare Artifacts too/u);
});

test("gq doctor reads the Node pin from .nvmrc when there is no .mise.toml", async () => {
  const fixture = await healthySite({ ".mise.toml": "[tools]\n", ".nvmrc": "v24.21.0\n" });
  const result = await fixture.run(["doctor"], { exec: machine() });
  assert.match(result.stdout, /✓ Node\.js 24\.21\.0 \(matches the \.nvmrc pin\)/u);
});

test("gq doctor reports stopped DDEV, missing env files and a logged-out Sigillo", async () => {
  const fixture = await site({
    files: { "apps/cms/vendor/autoload.php": "", "node_modules/.bin/sigillo": "" },
  });
  const exec = machine({
    ddev: null,
    codes: { "sigillo me --api-url https://secrets.example.test": 1 },
  });
  const result = await fixture.run(["doctor"], { exec });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /⚠ apps\/frontend\/\.env is missing/u);
  assert.match(result.stdout, /⚠ apps\/cms\/\.env is missing/u);
  assert.match(result.stdout, /⚠ Sigillo is not logged in — run: pnpm sigillo:login/u);
  assert.match(
    result.stdout,
    /⚠ DDEV is installed but fixture-admin is not running — run: pnpm cms:dev/u,
  );
});

test("gq doctor skips the Artifacts check for a site without an Artifacts mirror", async () => {
  const ops = { ...OPS, artifacts: undefined };
  const fixture = await createFixtureSite({
    ops,
    files: siteFiles({ "node_modules/.bin/sigillo": "" }),
  });
  const exec = machine();
  const result = await fixture.run(["doctor"], { exec });
  assert.doesNotMatch(result.stdout, /Artifacts/u);
  assert.ok(!actions(exec).some((line) => line.startsWith("git remote")));
});

// --- gq setup ----------------------------------------------------------------

test("gq setup --no-ddev installs, creates the .env files and skips DDEV and Composer", async () => {
  const fixture = await site();
  const exec = machine();
  const result = await fixture.run(["setup", "--no-ddev"], { cwd: fixture.path("apps"), exec });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(actions(exec), ["pnpm install --frozen-lockfile"]);
  assert.equal(exec.calls.find((call) => !isLookup(call)).cwd, fixture.root);
  assert.equal(await readFile(fixture.path("apps/cms/.env"), "utf8"), "WP_ENV='local'\n");
  assert.equal(
    await readFile(fixture.path("apps/frontend/.env"), "utf8"),
    "PUBLIC_GRAPHQL_URL=''\n",
  );
  assert.match(result.stdout, /--no-ddev: skipping DDEV and Composer/u);
  assert.match(result.stdout, /pnpm deploy:frontend/u);
});

test("gq setup keeps an existing .env and copes without an .env.example", async () => {
  const fixture = await site({
    files: { "apps/cms/.env": "KEEP=1\n", "apps/frontend/.env.example": null },
  });
  const result = await fixture.run(["setup", "--no-ddev"], { exec: machine() });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await readFile(fixture.path("apps/cms/.env"), "utf8"), "KEEP=1\n");
  assert.equal(existsSync(fixture.path("apps/frontend/.env")), false);
  assert.match(result.stdout, /apps\/cms\/\.env already exists — skipping/u);
  assert.match(result.stderr, /No apps\/frontend\/\.env\.example — skipping env copy/u);
});

test("gq setup starts DDEV and installs Composer through the site's scripts", async () => {
  const fixture = await site();
  const exec = machine();
  const result = await fixture.run(["setup"], { exec });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(actions(exec), [
    "pnpm install --frozen-lockfile",
    "pnpm cms:dev:raw --foreground",
    "pnpm cms:composer",
  ]);
  for (const call of exec.calls.filter((call) => !isLookup(call))) {
    assert.equal(call.cwd, fixture.root);
  }
});

test("gq setup skips WordPress without DDEV, and stops at a failing step", async () => {
  const noDdev = await site();
  const withoutDdev = machine({ installed: ["pnpm"] });
  const skipped = await noDdev.run(["setup"], { exec: withoutDdev });
  assert.equal(skipped.code, 0, skipped.stderr);
  assert.deepEqual(actions(withoutDdev), ["pnpm install --frozen-lockfile"]);
  assert.match(skipped.stderr, /ddev not found — skipping WordPress bootstrap/u);

  const failing = await site();
  const exec = machine({ codes: { "pnpm cms:dev:raw --foreground": 5 } });
  const failed = await failing.run(["setup"], { exec });
  assert.equal(failed.code, 5);
  assert.deepEqual(actions(exec), [
    "pnpm install --frozen-lockfile",
    "pnpm cms:dev:raw --foreground",
  ]);
});

test("gq setup needs pnpm", async () => {
  const fixture = await site();
  const exec = machine({ installed: [] });
  const result = await fixture.run(["setup", "--no-ddev"], { exec });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\[setup\] pnpm is required/u);
  assert.deepEqual(actions(exec), []);
});

test("gq setup and gq doctor take no options of their own beyond --no-ddev", async () => {
  const fixture = await site();
  await mkdir(fixture.path("node_modules"), { recursive: true });
  for (const argv of [
    ["setup", "--ci"],
    ["doctor", "--fix"],
  ]) {
    const result = await fixture.run(argv, { exec: machine() });
    assert.equal(result.code, 1, argv.join(" "));
    assert.match(result.stderr, /Usage: gq (setup \[--no-ddev\]|doctor)/u);
  }
});
