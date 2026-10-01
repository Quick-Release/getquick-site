// gq new and gq sync on the blueprint's managed files, driven through run():
// a site generated into a temporary directory, then kept in step with the
// installed blueprint, without touching what the site owns, a hand edit, the
// network or a provider.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import test from "node:test";

import { VERSION } from "../src/version.mjs";
import { createFixtureSite, runGq, temporaryDirectory } from "./support/fixture-site.mjs";

const MISE = '[tools]\nnode = "24.21.0"\n';

function hash(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function readSite(root, path) {
  return readFile(join(root, path), "utf8");
}

test("gq new writes a v1 manifest, the toolchain pins and the lock, then runs git init", async () => {
  const parent = await temporaryDirectory();
  const root = join(parent, "acme");

  const result = await runGq(["new", "acme", "--project", "acme", "--variant", "content"], {
    cwd: parent,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readSite(root, "gq.ops.json")), {
    $schema: "./node_modules/@getquick/site/schema/gq.ops.schema.json",
    schemaVersion: 1,
    project: "acme",
    variant: "content",
  });
  assert.equal(await readSite(root, ".mise.toml"), MISE);
  assert.deepEqual(JSON.parse(await readSite(root, "gq.lock.json")), {
    gq: VERSION,
    schemaVersion: 1,
    files: { ".mise.toml": hash(MISE) },
  });
  assert.deepEqual(
    result.exec.calls.map(({ command, args, cwd }) => ({ command, args, cwd })),
    [{ command: "git", args: ["init", "--quiet"], cwd: root }],
  );
  assert.deepEqual(result.fetch.requests, []);
});

// A site gq new generated, as its files are right after.
async function newSite() {
  const parent = await temporaryDirectory();
  const created = await runGq(["new", "acme", "--project", "acme", "--variant", "content"], {
    cwd: parent,
  });
  assert.equal(created.code, 0, created.stderr);
  const root = join(parent, "acme");
  return { root, run: (argv) => runGq(argv, { cwd: root }) };
}

// Every working-tree file's content and modification time.
async function snapshot(root) {
  const files = {};
  for (const path of await readdir(root, { recursive: true })) {
    if (path === ".git" || path.startsWith(`.git${sep}`)) continue;
    const stats = await stat(join(root, path));
    if (stats.isFile()) files[path] = { content: await readSite(root, path), mtime: stats.mtimeMs };
  }
  return files;
}

test("a site gq new generated is in sync: --check exits 0 and gq sync writes nothing", async () => {
  const site = await newSite();
  const before = await snapshot(site.root);

  const check = await site.run(["sync", "--check"]);
  assert.equal(check.code, 0, check.stderr);
  assert.equal(check.stdout, "gq.ops.json: up to date (schema v1).\nManaged files: up to date.\n");
  assert.equal(check.stderr, "");

  const sync = await site.run(["sync"]);
  assert.equal(sync.code, 0, sync.stderr);
  assert.equal(sync.stdout, "gq.ops.json: up to date (schema v1).\nManaged files: up to date.\n");
  assert.deepEqual(await snapshot(site.root), before);

  for (const { fetch, exec } of [check, sync]) {
    assert.deepEqual(fetch.requests, []);
    assert.deepEqual(exec.calls, []);
  }
});

test("a hand-edited managed file stops gq sync with a diff, and nothing is written", async () => {
  const site = await newSite();
  const edited = '[tools]\nnode = "24.21.0"\npython = "3.13"\n';
  await writeFile(join(site.root, ".mise.toml"), edited);
  const before = await snapshot(site.root);
  const diff = [
    ".mise.toml: edited since gq last wrote it (gq.lock.json); gq sync would write:",
    "--- .mise.toml",
    "+++ .mise.toml (gq sync)",
    "@@ -1,3 +1,2 @@",
    " [tools]",
    ' node = "24.21.0"',
    '-python = "3.13"',
    "",
  ].join("\n");
  const refusal =
    "gq: Local edits to managed files: .mise.toml. gq sync writes nothing until each is " +
    "reverted, or deleted to be regenerated.\n";

  for (const argv of [["sync"], ["sync", "--check"]]) {
    const result = await site.run(argv);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, `gq.ops.json: up to date (schema v1).\n${diff}`);
    assert.equal(result.stderr, refusal);
    assert.deepEqual(await snapshot(site.root), before);
  }
});

// A site an older gq generated: its lock records the toolchain pins that gq
// wrote, which the installed blueprint has since changed.
async function siteFromOlderGq(files = {}) {
  const oldMise = '[tools]\nnode = "24.20.0"\n';
  const lock = { gq: "0.8.0", schemaVersion: 1, files: { ".mise.toml": hash(oldMise) } };
  return createFixtureSite({
    ops: { schemaVersion: 1, project: "acme", variant: "content" },
    files: {
      ".mise.toml": oldMise,
      "gq.lock.json": `${JSON.stringify(lock, null, 2)}\n`,
      ...files,
    },
  });
}

test("a template change to an unedited managed file is applied and the lock updated", async () => {
  const site = await siteFromOlderGq();
  const before = await snapshot(site.root);

  const check = await site.run(["sync", "--check"]);
  assert.equal(check.code, 1);
  assert.equal(
    check.stdout,
    [
      "gq.ops.json: up to date (schema v1).",
      ".mise.toml: pending, gq sync would update it.",
      "gq.lock.json: pending, gq sync would update it.",
      "",
    ].join("\n"),
  );
  assert.deepEqual(await snapshot(site.root), before);

  const sync = await site.run(["sync"]);
  assert.equal(sync.code, 0, sync.stderr);
  assert.equal(
    sync.stdout,
    "gq.ops.json: up to date (schema v1).\n.mise.toml: updated.\ngq.lock.json: updated.\n",
  );
  assert.equal(await readSite(site.root, ".mise.toml"), MISE);
  assert.deepEqual(JSON.parse(await readSite(site.root, "gq.lock.json")), {
    gq: VERSION,
    schemaVersion: 1,
    files: { ".mise.toml": hash(MISE) },
  });
  assert.equal((await site.run(["sync", "--check"])).code, 0);
  for (const { fetch, exec } of [check, sync]) {
    assert.deepEqual(fetch.requests, []);
    assert.deepEqual(exec.calls, []);
  }
});

test("gq sync leaves site-owned files byte-identical", async () => {
  const owned = {
    "README.md": "# Acme\n",
    "docs/adr/0001-use-astro.md": "# ADR 0001\n",
    "apps/cms/web/app/plugins/acme-blocks/acme-blocks.php": "<?php\n",
    "package.json": '{ "name": "acme" }\n',
    ".gitignore": "node_modules\n",
  };
  const site = await siteFromOlderGq(owned);
  const before = await snapshot(site.root);

  const result = await site.run(["sync"]);

  assert.equal(result.code, 0, result.stderr);
  const after = await snapshot(site.root);
  for (const path of Object.keys(owned)) assert.deepEqual(after[path], before[path], path);
  assert.deepEqual(
    Object.keys(after).sort(),
    [...Object.keys(owned), ".mise.toml", "gq.lock.json", "gq.ops.json"].sort(),
  );
});

test("gq sync regenerates a deleted managed file", async () => {
  const site = await newSite();
  await rm(join(site.root, ".mise.toml"));

  const result = await site.run(["sync"]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "gq.ops.json: up to date (schema v1).\n.mise.toml: created.\n");
  assert.equal(await readSite(site.root, ".mise.toml"), MISE);
});

test("without a lock, a managed file that differs from the template counts as edited", async () => {
  const site = await createFixtureSite({
    ops: { schemaVersion: 1, project: "acme", variant: "content" },
    files: { ".mise.toml": '[tools]\nnode = "22.12.0"\n' },
  });
  const before = await snapshot(site.root);

  const result = await site.run(["sync"]);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /^\.mise\.toml: edited since gq last wrote it/mu);
  assert.match(result.stdout, /^-node = "22\.12\.0"\n\+node = "24\.21\.0"$/mu);
  assert.deepEqual(await snapshot(site.root), before);
});

test("a local edit also holds back a pending manifest migration", async () => {
  const v0 = { project: "acme" };
  const site = await createFixtureSite({
    ops: v0,
    files: { ".mise.toml": '[tools]\nnode = "22.12.0"\n' },
  });
  const before = await snapshot(site.root);

  const result = await site.run(["sync", "--variant", "content"]);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /^gq\.ops\.json: schema v0 → v1 pending\./u);
  assert.match(result.stderr, /^gq: Local edits to managed files: \.mise\.toml\./u);
  assert.deepEqual(await snapshot(site.root), before);
});

test("gq new refuses a commerce site and a directory that isn't empty", async () => {
  const parent = await temporaryDirectory();
  await writeFile(join(parent, "notes.md"), "mine\n");

  for (const [argv, message] of [
    [
      ["new", "shop", "--project", "shop", "--variant", "commerce"],
      "gq: gq new --variant commerce is not supported until phase 4.\n",
    ],
    [["new", ".", "--project", "acme", "--variant", "content"], `gq: ${parent} is not empty.\n`],
    [
      ["new", "acme", "--project", "acme"],
      "gq: Usage: gq new <dir> --project <name> --variant content\n",
    ],
  ]) {
    const result = await runGq(argv, { cwd: parent });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, message);
    assert.deepEqual(result.exec.calls, []);
  }
  assert.deepEqual(await readdir(parent), ["notes.md"]);
});

test("gq sync refuses a lock a newer gq wrote, instead of downgrading its files", async () => {
  const lock = { gq: "999.0.0", schemaVersion: 1, files: { ".mise.toml": hash(MISE) } };
  const site = await createFixtureSite({
    ops: { schemaVersion: 1, project: "acme", variant: "content" },
    files: { ".mise.toml": MISE, "gq.lock.json": `${JSON.stringify(lock, null, 2)}\n` },
  });
  const before = await snapshot(site.root);

  for (const argv of [["sync"], ["sync", "--check"]]) {
    const result = await site.run(argv);
    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `gq: gq.lock.json was written by gq 999.0.0, newer than the installed ${VERSION}. ` +
        "Update @getquick/site.\n",
    );
    assert.deepEqual(await snapshot(site.root), before);
  }
});
