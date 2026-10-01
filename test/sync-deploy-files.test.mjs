// gq new and gq sync on a site's deploy wiring, driven through run(): the
// Cloudflare CI Worker, the Frontend deploy config and script, and the CI
// release step, fully generated from gq.ops.json. Lombardi's manifest renders
// Lombardi's own files (test/fixtures/lombardi, as of Lombardi b2061a9).
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { createFixtureSite } from "./support/fixture-site.mjs";
import { hash, newSite, readSite, snapshot } from "./support/new-site.mjs";

const DEPLOY_PATHS = [
  "infra/ci/Dockerfile",
  "infra/ci/cloudflare.ci.ts",
  "infra/ci/env.ts",
  "infra/ci/github.ts",
  "infra/ci/mirror.ts",
  "infra/ci/package.json",
  "infra/ci/release.ts",
  "infra/ci/src/index.ts",
  "infra/ci/tsconfig.json",
  "infra/ci/wrangler.jsonc",
  "infra/frontend.run.ts",
  "infra/package.json",
  "infra/scripts/deploy-frontend.mjs",
  "infra/tsconfig.json",
  "scripts/ci-release.mjs",
  "scripts/ci.test.mjs",
];

const LOMBARDI = JSON.parse(
  await readFile(new URL("fixtures/manifests/lombardi.v1.json", import.meta.url), "utf8"),
);

// A site whose every value differs from Lombardi's.
const ACME = {
  schemaVersion: 1,
  project: "acme-shop",
  variant: "content",
  domains: { admin: "cms.acme.test", frontend: "www.acme.test" },
  artifacts: { namespace: "acme-ns", repo: "acme-repo" },
  ci: { worker: "acme-builds", backupBucket: "acme-snapshots" },
  cloudflare: { accountId: "0123456789abcdef0123456789abcdef", zoneName: "acme.test" },
  github: { repository: "Example/acme-site" },
};

function lombardiFile(path) {
  return readFile(new URL(`fixtures/lombardi/${path}`, import.meta.url), "utf8");
}

async function writeManifest(root, manifest) {
  await writeFile(join(root, "gq.ops.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

test("Lombardi's manifest renders Lombardi's CI Worker, Frontend deploy and release step", async () => {
  const fixture = await createFixtureSite({ ops: LOMBARDI });

  const result = await fixture.run(["sync"]);

  assert.equal(result.code, 0, result.stderr);
  const lock = JSON.parse(await readSite(fixture.root, "gq.lock.json"));
  for (const path of DEPLOY_PATHS) {
    const expected = await lombardiFile(path);
    assert.equal(await readSite(fixture.root, path), expected, path);
    assert.equal(lock.files[path], hash(expected), path);
  }
});

test("every site value in the deploy files comes from gq.ops.json", async () => {
  const fixture = await createFixtureSite({ ops: ACME });

  const result = await fixture.run(["sync"]);

  assert.equal(result.code, 0, result.stderr);
  const wrangler = await readSite(fixture.root, "infra/ci/wrangler.jsonc");
  for (const line of [
    "  // AcmeShop CI on Cloudflare: pushes to the Artifacts repository (gq.ops.json",
    '  "name": "acme-builds",',
    '  "artifacts": [{ "binding": "ARTIFACTS", "namespace": "acme-ns" }],',
    '    { "name": "acme-builds", "binding": "CI_WORKFLOW", "class_name": "CI" },',
    '    { "name": "acme-shop-mirror", "binding": "MIRROR_WORKFLOW", "class_name": "Mirror" },',
    '        "filter": { "namespace": "acme-ns", "repo_name": "acme-repo" },',
    '        "targets": [{ "type": "workflow", "workflow_name": "acme-builds" }],',
    '  "r2_buckets": [{ "binding": "BACKUP_BUCKET", "bucket_name": "acme-snapshots" }],',
    '    "BACKUP_BUCKET_NAME": "acme-snapshots",',
    '    "CLOUDFLARE_ACCOUNT_ID": "0123456789abcdef0123456789abcdef",',
    '    "CLOUDFLARE_DEPLOY_ACCOUNT_ID": "0123456789abcdef0123456789abcdef",',
    '    "ARTIFACTS_NAMESPACE": "acme-ns",',
    '    "ARTIFACTS_REPO": "acme-repo",',
    '    "GITHUB_REPOSITORY": "Example/acme-site",',
  ]) {
    assert.ok(wrangler.split("\n").includes(line), `wrangler.jsonc lacks: ${line}`);
  }
  const frontend = await readSite(fixture.root, "infra/frontend.run.ts");
  assert.match(frontend, /^ {2}"AcmeShopFrontend",$/mu);
  assert.match(frontend, /name: production \? "acme-shop-fe" : `acme-shop-fe-\$\{stage\}`,/u);
  assert.match(await readSite(fixture.root, "infra/ci/package.json"), /"name": "@acme-shop\/ci",/u);
  assert.match(
    await readSite(fixture.root, "infra/ci/github.ts"),
    /"User-Agent": "acme-shop-ci",/u,
  );

  // Nothing of Lombardi's is left in any deploy file.
  for (const path of DEPLOY_PATHS) {
    const content = await readSite(fixture.root, path);
    for (const pattern of [/lombardi/iu, /8f38791a8c37b182239af2a385ab3c31/u, /bnq\.pt/u]) {
      assert.doesNotMatch(content, pattern, path);
    }
  }
});

test("a gq new site's deploy files hold placeholders until gq.ops.json has the values", async () => {
  const site = await newSite();
  const wrangler = await readSite(site.root, "infra/ci/wrangler.jsonc");
  assert.match(wrangler, /^ {2}"name": "<ci\.worker>",$/mu);
  assert.match(wrangler, /^ {4}"CLOUDFLARE_ACCOUNT_ID": "<cloudflare\.accountId>",$/mu);
  assert.match(wrangler, /^ {4}"GITHUB_REPOSITORY": "<github\.repository>",$/mu);

  await writeManifest(site.root, { ...ACME, project: "acme" });
  const check = await site.run(["sync", "--check"]);
  assert.equal(check.code, 1);
  assert.equal(
    check.stdout,
    [
      "gq.ops.json: up to date (schema v1).",
      "infra/ci/wrangler.jsonc: pending, gq sync would update it.",
      "scripts/ci.test.mjs: pending, gq sync would update it.",
      "gq.lock.json: pending, gq sync would update it.",
      "",
    ].join("\n"),
  );

  const sync = await site.run(["sync"]);
  assert.equal(sync.code, 0, sync.stderr);
  const synced = await readSite(site.root, "infra/ci/wrangler.jsonc");
  assert.match(synced, /^ {2}"name": "acme-builds",$/mu);
  assert.doesNotMatch(synced, /<[a-zA-Z.]+>/u);
  const lock = JSON.parse(await readSite(site.root, "gq.lock.json"));
  assert.equal(lock.files["infra/ci/wrangler.jsonc"], hash(synced));

  const again = await site.run(["sync", "--check"]);
  assert.equal(again.code, 0, again.stdout);
});

test("a hand-edited deploy file stops gq sync even when gq.ops.json changed too", async () => {
  const site = await newSite();
  const path = "infra/ci/wrangler.jsonc";
  const edited = (await readSite(site.root, path)).replace(
    '"max_instances": 6,',
    '"max_instances": 9,',
  );
  await writeFile(join(site.root, path), edited);
  await writeManifest(site.root, { ...ACME, project: "acme" });
  const before = await snapshot(site.root);

  const result = await site.run(["sync"]);

  assert.equal(result.code, 1);
  assert.match(
    result.stdout,
    /^infra\/ci\/wrangler\.jsonc: edited since gq last wrote it \(gq\.lock\.json\); gq sync would write:$/mu,
  );
  assert.match(result.stdout, /^- {6}"max_instances": 9,$/mu);
  assert.match(result.stdout, /^\+ {2}"name": "acme-builds",$/mu);
  assert.match(result.stderr, /Local edits to managed files: infra\/ci\/wrangler\.jsonc\./u);
  assert.deepEqual(await snapshot(site.root), before);
});

test("no secret reaches a generated file, and generation calls no provider", async () => {
  const secrets = {
    CLOUDFLARE_API_TOKEN: "secret-cloudflare-token",
    CI_DEPLOY_API_TOKEN: "secret-ci-deploy-token",
    PLOI_API_TOKEN: "secret-ploi-token",
    R2_ACCESS_KEY_ID: "secret-r2-key-id",
    R2_SECRET_ACCESS_KEY: "secret-r2-key",
    GITHUB_CI_TOKEN: "secret-github-token",
    GITHUB_WEBHOOK_SECRET: "secret-webhook",
    COMPOSER_AUTH: '{"http-basic":{"secret-registry":{"password":"secret-password"}}}',
    SIGILLO_TOKEN: "secret-sigillo-token",
  };
  const fixture = await createFixtureSite({ ops: LOMBARDI });

  const result = await fixture.run(["sync"], { env: secrets });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.fetch.requests, []);
  assert.deepEqual(result.exec.calls, []);
  for (const [path, { content }] of Object.entries(await snapshot(fixture.root))) {
    assert.doesNotMatch(content ?? "", /secret-/u, path);
  }
});
