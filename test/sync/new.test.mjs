// gq new's content site, driven through run(): the CMS and Frontend
// skeletons, env templates and workspace config it creates once, the
// provisioning steps it prints without running, the values it prompts for in
// a terminal (and names when it can't), and the secrets it never writes.
import assert from "node:assert/strict";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { VERSION } from "../../src/version.mjs";
import { runGq, temporaryDirectory } from "../support/fixture-site.mjs";
import { newSite, readSite, snapshot } from "../support/generated-site.mjs";

const PLUGINS = [
  "gq-design",
  "gq-support",
  "wp-graphql",
  "wpgraphql-blocks",
  "s3-uploads",
  "simple-history",
  "cimo-image-optimizer",
  "safe-svg",
];

test("gq new writes a v1 manifest whose plugins are the ones the CMS skeleton installs", async () => {
  const site = await newSite();

  const manifest = JSON.parse(await readSite(site.root, "gq.ops.json"));
  assert.deepEqual(manifest.wordpress, { plugins: PLUGINS });
  const composer = JSON.parse(await readSite(site.root, "apps/cms/composer.json"));
  for (const plugin of PLUGINS) {
    const installed = Object.keys(composer.require).some((name) => name.endsWith(`/${plugin}`));
    assert.ok(installed, plugin);
  }
  assert.equal(composer.require["getquick/gq-design"], "^0.3.1");
  assert.equal(composer.require["getquick/getquick-design"], undefined);
  assert.equal(composer.require["getquick/getquick-theme"], "^0.5.0");
  // The deploy script activates exactly that list.
  assert.match(
    await readSite(site.root, "deploy/ploi/admin.sh"),
    new RegExp(`^ {2}for plugin in ${PLUGINS.join(" ")}; do$`, "mu"),
  );
});

test("gq new writes a workspace whose root scripts run the Frontend and the pinned gq", async () => {
  const site = await newSite();

  const root = JSON.parse(await readSite(site.root, "package.json"));
  assert.equal(root.name, "acme");
  assert.equal(root.private, true);
  assert.equal(root.scripts.check, "pnpm --filter @acme/frontend check");
  assert.equal(root.scripts.test, "pnpm --filter @acme/frontend test");
  assert.equal(root.scripts.verify, "gq verify");
  assert.equal(root.devDependencies["@getquick/site"], VERSION);
  assert.match(root.devDependencies.sigillo, /^\d+\.\d+\.\d+$/u);
  assert.equal(root.packageManager, "pnpm@12.6.0");
  assert.equal(await readSite(site.root, "VERSION"), `${root.version}\n`);

  const frontend = JSON.parse(await readSite(site.root, "apps/frontend/package.json"));
  assert.equal(frontend.name, "@acme/frontend");
  assert.equal(frontend.version, root.version);
  const workspace = await readSite(site.root, "pnpm-workspace.yaml");
  for (const line of ['  - "apps/*"', '  - "infra"', '  - "infra/ci"']) {
    assert.ok(workspace.split("\n").includes(line), line);
  }
});

test("gq new writes CMS and Frontend skeletons named after the project", async () => {
  const site = await newSite();

  assert.match(await readSite(site.root, "apps/cms/.ddev/config.yaml"), /^name: acme-admin$/mu);
  assert.match(
    await readSite(site.root, "apps/frontend/.env.example"),
    /^PUBLIC_WORDPRESS_GRAPHQL_URL=https:\/\/acme-admin\.ddev\.site\/wp\/graphql$/mu,
  );
  assert.match(
    await readSite(site.root, "apps/frontend/src/lib/wp-block-renderer.ts"),
    /^export function renderWordPressBlocks\(/mu,
  );
  // Lombardi's own plugins, child theme and pages stay in Lombardi.
  const files = Object.entries(await snapshot(site.root));
  for (const [path, { content }] of files) {
    assert.doesNotMatch(path, /lombardi/iu);
    if (content !== undefined) assert.doesNotMatch(content, /lombardi/iu, path);
  }
  for (const path of ["deploy/ploi/admin.d/10-theme.sh", "apps/cms/.ddev/commands/host/db-sync"]) {
    assert.equal((await lstat(join(site.root, path))).mode & 0o777, 0o755, path);
  }
});

test("gq new's env templates hold public configuration and placeholders only", async () => {
  const site = await newSite();

  const production = await readSite(site.root, "apps/cms/.env.production.example");
  assert.match(production, /^WP_HOME='https:\/\/<domains\.admin>'$/mu);
  assert.match(production, /^GRAPHQL_CORS_ORIGINS='https:\/\/<domains\.frontend>'$/mu);
  for (const [path, allowed] of [
    ["apps/cms/.env.production.example", /^(?:''|'replace-me'|'replace-with-a-strong-password')$/u],
    ["apps/cms/.env.example", /^(?:''|'db'|'acme-local-[a-z-]+')$/u],
    ["apps/frontend/.env.example", /^$/u],
  ]) {
    for (const [name, value] of envEntries(await readSite(site.root, path))) {
      if (/KEY|SECRET|TOKEN|PASSWORD|SALT|AUTH/u.test(name)) assert.match(value, allowed, name);
    }
  }
});

test("gq new reads no secret, calls no provider and writes none of the environment", async () => {
  const parent = await temporaryDirectory();
  const secrets = {
    CLOUDFLARE_API_TOKEN: "cf-secret-0123456789",
    PLOI_API_TOKEN: "ploi-secret-0123456789",
    COMPOSER_AUTH: '{"http-basic":{"proxy.composer.getquick.io":{"password":"pw-0123456789"}}}',
    SIGILLO_TOKEN: "sigillo-secret-0123456789",
  };

  const result = await runGq(["new", "acme", "--project", "acme", "--variant", "content"], {
    cwd: parent,
    env: secrets,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.fetch.requests, []);
  assert.deepEqual(
    result.exec.calls.map(({ command, args }) => [command, ...args]),
    [["git", "init", "--quiet"]],
  );
  const root = join(parent, "acme");
  for (const [path, { content = "" }] of Object.entries(await snapshot(root))) {
    for (const [name, value] of Object.entries(secrets)) {
      assert.ok(!content.includes(value), `${path} holds ${name}`);
    }
  }
});

test("gq new prints the provisioning sequence and runs none of it", async () => {
  const parent = await temporaryDirectory();

  const result = await runGq(["new", "acme", "--project", "acme", "--variant", "content"], {
    cwd: parent,
  });

  assert.equal(result.code, 0, result.stderr);
  const next = result.stdout.slice(result.stdout.indexOf("\nNext,"));
  assert.equal(
    next,
    [
      "",
      "Next, provision acme with the existing commands (gq new ran none of them):",
      "  cd acme",
      "  pnpm install",
      "  # Fill in gq.ops.json (sigillo, domains, ploi, releases, media, backups,",
      "  # cloudflare, artifacts, ci, github), then regenerate the managed files:",
      "  pnpm exec gq sync",
      "  pnpm ploi:provision       # gq ploi provision",
      "  pnpm cf:deploy-token      # gq cloudflare deploy-token",
      "  pnpm cf:releases          # gq cloudflare releases",
      "  pnpm cf:media             # gq cloudflare media",
      "  pnpm cf:ci                # gq cloudflare ci",
      "  pnpm github:setup         # gq github setup",
      "  pnpm ci:deploy            # gq ci deploy",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    result.exec.calls.map(({ command }) => command),
    ["git"],
  );
});

test("gq new refuses a project name that can't name packages, Workers and DDEV", async () => {
  const parent = await temporaryDirectory();

  for (const project of ["Acme", "acme site", "-acme", "acme_site", "9acme"]) {
    const result = await runGq(["new", "acme", "--project", project, "--variant", "content"], {
      cwd: parent,
    });
    assert.equal(result.code, 1, project);
    assert.equal(
      result.stderr,
      `gq: --project must be lowercase letters, digits and hyphens, starting with a letter: ${project}\n`,
    );
  }
  assert.deepEqual(await readdir(parent), []);
});

test("outside a terminal, gq new names every value it is missing and writes nothing", async () => {
  const parent = await temporaryDirectory();

  for (const [argv, missing] of [
    [["new"], "<dir>, --project and --variant"],
    [["new", "acme", "--variant", "content"], "--project"],
    [["new", "--project", "acme"], "<dir> and --variant"],
  ]) {
    const result = await runGq(argv, { cwd: parent });
    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `gq: gq new is missing ${missing}; pass them, or run it in a terminal to be asked. ` +
        "Usage: gq new <dir> --project <name> --variant content\n",
    );
    assert.deepEqual(result.exec.calls, []);
  }
  assert.deepEqual(await readdir(parent), []);
});

test("in a terminal, gq new asks only for the values it is missing", async () => {
  const parent = await temporaryDirectory();
  // Enter accepts the project's suggestion (the directory's name) and the
  // only variant gq new can create.
  const stdin = answering(["\r", "\r"]);

  const result = await runGq(["new", "acme"], { cwd: parent, stdin, interactive: true });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(stdin.prompts, 2);
  assert.match(result.stdout, /Project name/u);
  assert.match(result.stdout, /Variant/u);
  assert.doesNotMatch(result.stdout, /Directory/u);
  const manifest = JSON.parse(await readSite(join(parent, "acme"), "gq.ops.json"));
  assert.equal(manifest.project, "acme");
  assert.equal(manifest.variant, "content");
});

test("in a terminal, gq new asks for the directory and project when neither is given", async () => {
  const parent = await temporaryDirectory();
  const stdin = answering(["shop\r", "\r"]);

  const result = await runGq(["new", "--variant", "content"], {
    cwd: parent,
    stdin,
    interactive: true,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(stdin.prompts, 2);
  // The directory defaults to the project's name.
  const manifest = JSON.parse(await readSite(join(parent, "shop"), "gq.ops.json"));
  assert.equal(manifest.project, "shop");
});

test("cancelling gq new's prompt writes nothing", async () => {
  const parent = await temporaryDirectory();
  const stdin = answering(["\u0003"]);

  const result = await runGq(["new", "--variant", "content"], {
    cwd: parent,
    stdin,
    interactive: true,
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /gq new cancelled; nothing was written\./u);
  assert.deepEqual(await readdir(parent), []);
  assert.deepEqual(result.exec.calls, []);
});

// A terminal's input that types the next answer each time a prompt starts
// listening for keys (its first keypress listener; it adds more).
function answering(answers) {
  const stdin = new PassThrough();
  stdin.prompts = 0;
  stdin.on("newListener", (event) => {
    if (event !== "keypress" || stdin.listenerCount("keypress") > 0) return;
    const answer = answers[stdin.prompts];
    stdin.prompts += 1;
    if (answer !== undefined) setImmediate(() => stdin.write(answer));
  });
  return stdin;
}

// `NAME=value` lines, with the value as written (quotes kept).
function envEntries(text) {
  return text
    .split("\n")
    .filter((line) => /^[A-Z_]+=/u.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]);
}
