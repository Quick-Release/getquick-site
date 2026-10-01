// gq.ops.json schema v1 and its migrations, driven through run(): `gq sync
// --manifest [--check]` against fixture sites holding Lombardi's and Ekis's
// real v0 manifests, and the refusals every other command makes when the
// manifest is older, newer, or invalid.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { manifestJsonSchema } from "../src/manifest/schema.mjs";
import { VERSION } from "../src/version.mjs";
import { createFixtureSite } from "./support/fixture-site.mjs";

const LOMBARDI_V0 = await readFixture("lombardi.v0.json");
const EKIS_V0 = await readFixture("ekis.v0.json");
const SCHEMA_URL = "./node_modules/@getquick/site/schema/gq.ops.schema.json";

async function readFixture(name) {
  return JSON.parse(await readFile(new URL(`fixtures/manifests/${name}`, import.meta.url), "utf8"));
}

async function readManifest(fixture) {
  return readFile(fixture.path("gq.ops.json"), "utf8");
}

test("gq sync --manifest migrates Lombardi's v0 manifest to v1", async () => {
  const fixture = await createFixtureSite({ ops: LOMBARDI_V0 });

  const result = await fixture.run(["sync", "--manifest", "--variant", "content"]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "gq.ops.json: migrated schema v0 → v1.\n");
  assert.equal(result.stderr, "");
  const { project, ...rest } = LOMBARDI_V0;
  const expected = { $schema: SCHEMA_URL, schemaVersion: 1, project, variant: "content", ...rest };
  assert.equal(await readManifest(fixture), `${JSON.stringify(expected, null, 2)}\n`);
});

test("gq sync --manifest migrates Ekis's v0 manifest to v1, naming each key it drops", async () => {
  const fixture = await createFixtureSite({ ops: EKIS_V0 });

  const result = await fixture.run(["sync", "--manifest", "--variant", "commerce"]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "gq.ops.json: migrated schema v0 → v1.\n");
  assert.equal(
    result.stderr,
    [
      "warning: gq.ops.json dropped credentials: gq no longer writes provider credentials to .env.",
      "warning: gq.ops.json dropped github.environment: gq no longer syncs GitHub Actions secrets and variables.",
      "warning: gq.ops.json dropped github.secrets: gq no longer syncs GitHub Actions secrets and variables.",
      "warning: gq.ops.json dropped github.variables: gq no longer syncs GitHub Actions secrets and variables.",
      "",
    ].join("\n"),
  );
  assert.deepEqual(JSON.parse(await readManifest(fixture)), {
    $schema: SCHEMA_URL,
    schemaVersion: 1,
    project: "ekis",
    variant: "commerce",
    sigillo: EKIS_V0.sigillo,
    domains: { admin: "ekis-admin.bnq.pt", docs: "ekis-docs.bnq.pt", frontend: "ekis.bnq.pt" },
    ploi: { serverId: "", siteId: "" },
    cloudflare: { accountId: "8f38791a8c37b182239af2a385ab3c31", zoneId: "", zoneName: "bnq.pt" },
    github: { repository: "Quick-Release/ekis" },
  });
});

test("migrating a v1 manifest is a no-op", async () => {
  for (const [v0, variant] of [
    [LOMBARDI_V0, "content"],
    [EKIS_V0, "commerce"],
  ]) {
    const fixture = await createFixtureSite({ ops: v0 });
    await fixture.run(["sync", "--manifest", "--variant", variant]);
    const migrated = await readManifest(fixture);

    for (const argv of [["sync", "--manifest"], ["sync", "--manifest", "--check"], ["sync"]]) {
      const result = await fixture.run(argv);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, "gq.ops.json: up to date (schema v1).\n");
      assert.equal(result.stderr, "");
      assert.equal(await readManifest(fixture), migrated);
    }
  }
});

test("gq sync --manifest --check reports a pending migration and writes nothing", async () => {
  const fixture = await createFixtureSite({ ops: EKIS_V0 });
  const before = await readManifest(fixture);

  const result = await fixture.run(["sync", "--manifest", "--check", "--variant", "commerce"]);

  assert.equal(result.code, 1);
  assert.equal(
    result.stdout,
    "gq.ops.json: schema v0 → v1 pending. " +
      "Run gq sync --manifest --variant commerce to apply it.\n",
  );
  assert.match(result.stderr, /^warning: gq\.ops\.json dropped credentials: /u);
  assert.equal(await readManifest(fixture), before);
});

test("gq sync --check reports a v0 manifest as pending without a variant", async () => {
  const fixture = await createFixtureSite({ ops: LOMBARDI_V0 });
  const before = await readManifest(fixture);

  const result = await fixture.run(["sync", "--check"]);

  assert.equal(result.code, 1);
  assert.equal(
    result.stdout,
    "gq.ops.json: schema v0 → v1 pending. " +
      "Run gq sync --manifest --variant <content|commerce> to apply it.\n",
  );
  assert.equal(result.stderr, "");
  assert.equal(await readManifest(fixture), before);
});

test("gq sync refuses a --variant that contradicts a v1 manifest's", async () => {
  const fixture = await createFixtureSite({ ops: EKIS_V0 });
  await fixture.run(["sync", "--manifest", "--variant", "commerce"]);

  const result = await fixture.run(["sync", "--variant", "content"]);

  assert.equal(result.code, 1);
  assert.equal(
    result.stderr,
    "gq: gq.ops.json declares variant commerce; --variant content only applies when " +
      "migrating a v0 manifest.\n",
  );
});

test("migrating a v0 manifest asks for the variant instead of guessing it", async () => {
  const fixture = await createFixtureSite({ ops: LOMBARDI_V0 });
  const before = await readManifest(fixture);

  for (const argv of [
    ["sync", "--manifest"],
    ["sync", "--manifest", "--variant", "shop"],
  ]) {
    const result = await fixture.run(argv);
    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      "gq: Migrating gq.ops.json to schema v1 needs the site's variant: " +
        "pass --variant content or --variant commerce.\n",
    );
    assert.equal(await readManifest(fixture), before);
  }
});

test("commands refuse a manifest older than v1, pointing at gq sync --manifest", async () => {
  const fixture = await createFixtureSite({ ops: LOMBARDI_V0 });

  const result = await fixture.run(["context", "show"]);

  assert.equal(result.code, 1);
  assert.equal(
    result.stderr,
    "gq: gq.ops.json is schema v0, older than this gq reads (v1). " +
      "Run gq sync --manifest --variant <content|commerce> to migrate it.\n",
  );
});

test("commands and gq sync refuse a manifest newer than the installed gq", async () => {
  const fixture = await createFixtureSite({
    ops: { schemaVersion: 2, project: "future", variant: "content" },
  });

  for (const argv of [
    ["context", "show"],
    ["sync", "--manifest"],
  ]) {
    const result = await fixture.run(argv);
    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `gq: gq.ops.json is schema v2, newer than gq ${VERSION} reads (v1). Update @getquick/site.\n`,
    );
  }
});

test("an invalid manifest fails naming each key path", async () => {
  for (const [ops, problems] of [
    [{ schemaVersion: 1, variant: "content" }, "project is required"],
    [
      { schemaVersion: 1, project: "fixture", variant: "shop" },
      'variant must be "content" or "commerce"',
    ],
    [
      {
        schemaVersion: 1,
        project: "fixture",
        variant: "content",
        domains: { admin: "admin.example.test", staging: "staging.example.test" },
        ploi: { serverID: "12" },
        wordpress: { plugins: ["getquick-config", 7] },
      },
      "domains.frontend is required; domains.staging is not a known key; " +
        "ploi.serverID is not a known key; " +
        "wordpress.plugins[1]: Invalid input: expected string, received number",
    ],
    [{ schemaVersion: "1", project: "fixture" }, null],
  ]) {
    const fixture = await createFixtureSite({ ops });
    const result = await fixture.run(["context", "show"]);
    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      problems === null
        ? "gq: gq.ops.json schemaVersion must be a non-negative integer.\n"
        : `gq: gq.ops.json is invalid: ${problems}.\n`,
    );
  }
});

test("the published JSON Schema is the one generated from the zod schema", async () => {
  const published = await readFile(
    new URL("../schema/gq.ops.schema.json", import.meta.url),
    "utf8",
  );
  assert.equal(published, `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`);
  assert.equal(JSON.parse(published).additionalProperties, false);
  assert.deepEqual(JSON.parse(published).required, ["schemaVersion", "project", "variant"]);
});
