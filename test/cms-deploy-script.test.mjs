// The CMS deploy script (deploy/ploi/admin.sh), fully generated from
// gq.ops.json, run as Ploi runs it: in a site directory, with stub wp,
// composer, rsync, curl, php and sudo on PATH that record their calls.
import assert from "node:assert/strict";
import { access, lstat, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ploiReleaseShippedPaths } from "../src/index.mjs";
import { unifiedDiff } from "../src/sync/diff.mjs";

import { createFixtureSite } from "./support/fixture-site.mjs";
import { deploy, recordingExtension } from "./support/deploy-script.mjs";
import { hash, newSite, readSite } from "./support/new-site.mjs";

const PLUGINS = ["getquick-design", "acme-blocks", "wp-graphql"];

const ACME = {
  schemaVersion: 1,
  project: "acme-shop",
  variant: "content",
  wordpress: { plugins: PLUGINS },
};

const LOMBARDI = JSON.parse(await readFixture("manifests/lombardi.v1.json"));

function readFixture(path) {
  return readFile(new URL(`fixtures/${path}`, import.meta.url), "utf8");
}

// The deploy script gq sync renders for `manifest`.
async function generatedScript(manifest = ACME) {
  const fixture = await createFixtureSite({ ops: manifest });
  const result = await fixture.run(["sync"]);
  assert.equal(result.code, 0, result.stderr);
  return readSite(fixture.root, "deploy/ploi/admin.sh");
}

function wpCalls(calls, command) {
  return calls.filter(([tool, ...args]) => tool === "wp" && args.join(" ").startsWith(command));
}

test("the deploy script activates exactly the plugins gq.ops.json lists, in order", async () => {
  const result = await deploy(await generatedScript());

  assert.equal(result.code, 0, result.output);
  assert.deepEqual(
    wpCalls(result.calls, "plugin activate").map(([, , , plugin]) => plugin),
    PLUGINS,
  );
  assert.deepEqual(
    wpCalls(result.calls, "plugin is-installed").map(([, , , plugin]) => plugin),
    PLUGINS,
  );
  assert.match(result.stdout, /^ACME_SHOP_DEPLOY_STATUS=success SHA=0123abcd$/mu);
});

test("the deploy script replaces exactly the paths gq ploi release ships", async () => {
  const result = await deploy(await generatedScript());

  assert.equal(result.code, 0, result.output);
  // The main rsync protects what the server owns; the copy-back of shipped
  // plugins and themes doesn't.
  const replaced = result.calls.filter(
    ([tool, ...args]) => tool === "rsync" && args.includes("--filter=P /.env"),
  );
  assert.deepEqual(
    replaced.map((call) => call.at(-1)),
    ploiReleaseShippedPaths.map((path) => `${path}/`),
  );
});

test("the deploy extensions run in lexical order from apps/cms, after activation and update-db", async () => {
  const result = await deploy(await generatedScript(), {
    releaseFiles: {
      "deploy/ploi/admin.d/20-retire.sh": recordingExtension("20-retire.sh"),
      "deploy/ploi/admin.d/10-theme.sh": recordingExtension("10-theme.sh"),
      "deploy/ploi/admin.d/9-late.sh": recordingExtension("9-late.sh"),
      "deploy/ploi/admin.d/a-lower.sh": recordingExtension("a-lower.sh"),
      "deploy/ploi/admin.d/B-upper.sh": recordingExtension("B-upper.sh"),
      // Not an extension: only *.sh files run.
      "deploy/ploi/admin.d/README.md": "# Deploy extensions\n",
      "deploy/ploi/admin.d/notes.txt": recordingExtension("notes.txt"),
    },
  });

  assert.equal(result.code, 0, result.output);
  const ran = result.calls.filter(([tool]) => tool === "extension");
  assert.deepEqual(
    ran.map(([, name]) => name),
    ["10-theme.sh", "20-retire.sh", "9-late.sh", "B-upper.sh", "a-lower.sh"],
  );
  for (const [, , cwd] of ran) assert.equal(cwd, `${result.site}/apps/cms`);
  // After the last activation and the database update, before the flush.
  const at = (call) => result.calls.indexOf(call);
  assert.ok(at(wpCalls(result.calls, "plugin activate").at(-1)) < at(ran[0]));
  assert.ok(at(wpCalls(result.calls, "core update-db")[0]) < at(ran[0]));
  assert.ok(at(ran.at(-1)) < at(wpCalls(result.calls, "rewrite flush")[0]));
  assert.match(result.stdout, /^Running deploy extension deploy\/ploi\/admin\.d\/10-theme\.sh$/mu);
});

test("a failing deploy extension fails the deploy and leaves maintenance mode off", async () => {
  const result = await deploy(await generatedScript(), {
    releaseFiles: {
      "deploy/ploi/admin.d/10-first.sh": recordingExtension("10-first.sh"),
      "deploy/ploi/admin.d/20-fails.sh": recordingExtension("20-fails.sh", 3),
      "deploy/ploi/admin.d/30-never.sh": recordingExtension("30-never.sh"),
    },
  });

  assert.equal(result.code, 3);
  assert.deepEqual(
    result.calls.filter(([tool]) => tool === "extension").map(([, name]) => name),
    ["10-first.sh", "20-fails.sh"],
  );
  assert.match(
    result.stderr,
    /^Deploy extension deploy\/ploi\/admin\.d\/20-fails\.sh failed \(exit 3\)\.$/mu,
  );
  assert.match(result.stdout, /^ACME_SHOP_DEPLOY_STATUS=failed EXIT_CODE=3 SHA=0123abcd$/mu);
  const maintenance = wpCalls(result.calls, "maintenance-mode").map(([, , action]) => action);
  assert.deepEqual(maintenance, ["activate", "deactivate"]);
  assert.deepEqual(result.calls.at(-1), ["wp", "maintenance-mode", "deactivate"]);
  assert.doesNotMatch(result.stdout, /^ACME_SHOP_DEPLOY_STATUS=success/mu);
});

test("before WordPress is installed, the deploy activates nothing and runs no extension", async () => {
  const result = await deploy(await generatedScript(), {
    installed: false,
    releaseFiles: { "deploy/ploi/admin.d/10-theme.sh": recordingExtension("10-theme.sh") },
  });

  assert.equal(result.code, 0, result.output);
  assert.deepEqual(
    result.calls.filter(([tool]) => tool === "wp").map((call) => call.join(" ")),
    ["wp core is-installed", "wp maintenance-mode deactivate"],
  );
  assert.match(result.stdout, /^ACME_SHOP_DEPLOY_STATUS=success SHA=0123abcd$/mu);
});

test("a site without deploy extensions deploys", async () => {
  const result = await deploy(await generatedScript());

  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.output, /extension/u);
  assert.deepEqual(
    wpCalls(result.calls, "maintenance-mode").map(([, , action]) => action),
    ["activate", "deactivate"],
  );
});

test("the deploy passes COMPOSER_AUTH to Composer and never prints it", async () => {
  const composerAuth = '{"http-basic":{"proxy.composer.getquick.io":{"password":"secret-login"}}}';
  for (const releaseFiles of [
    {},
    { "deploy/ploi/admin.d/10-fails.sh": recordingExtension("10-fails.sh", 1) },
  ]) {
    const result = await deploy(await generatedScript(), { composerAuth, releaseFiles });

    assert.equal(result.composerAuth, composerAuth);
    assert.doesNotMatch(result.output, /secret-login/u);
  }
});

// Lombardi's current script (b2061a9) against the one its migrated manifest
// renders plus test/fixtures/lombardi-phase-3, the extension that takes over
// Lombardi's own steps in phase 3.
test("Lombardi's manifest and deploy extension deploy as Lombardi's current script does", async () => {
  const siteFiles = {
    ".git/HEAD": "ref: refs/heads/main\n",
    "packages/wordpress/getquick-design/getquick-design.php": "<?php\n",
    "apps/cms/web/app/plugins/getquick-options/getquick-design.php": "<?php\n",
    "apps/cms/web/app/plugins/getquick-post-types/getquick-post-types.php": "<?php\n",
    "apps/cms/web/app/plugins/lombardi-contact/lombardi-contact.php": "<?php\n",
  };
  const releaseFiles = {
    "apps/cms/web/app/plugins/lombardi-blocks/lombardi-blocks.php": "<?php\n",
    "apps/cms/web/app/themes/lombardi-theme/style.css": "/* Theme Name: Lombardi */\n",
  };
  const current = await deploy(await readFixture("lombardi/deploy/ploi/admin.sh"), {
    siteFiles,
    releaseFiles,
  });
  const generated = await deploy(await generatedScript(LOMBARDI), {
    siteFiles,
    releaseFiles: {
      ...releaseFiles,
      "deploy/ploi/admin.d/10-lombardi.sh": await readFixture(
        "lombardi-phase-3/deploy/ploi/admin.d/10-lombardi.sh",
      ),
    },
  });

  for (const result of [current, generated]) {
    assert.equal(result.code, 0, result.output);
    assert.match(result.stdout, /^LOMBARDI_DEPLOY_STATUS=success SHA=0123abcd$/mu);
    for (const path of Object.keys(siteFiles)) {
      await assert.rejects(access(join(result.site, path)), { code: "ENOENT" }, path);
    }
  }
  // The same calls in the same order, except that the moved steps' wp calls
  // run later, still in their own order.
  const normalized = ({ calls }) =>
    calls.map((call) =>
      call.map((arg) => arg.replace(/^\/.*\/(release\.tar\.gz|release\/)/u, "<tmp>/$1")).join(" "),
    );
  const moved = (call) => /lombardi-theme|lombardi-contact|deactivate_plugins/u.test(call);
  const [currentCalls, generatedCalls] = [current, generated].map(normalized);
  assert.deepEqual(
    generatedCalls.filter((call) => !moved(call)),
    currentCalls.filter((call) => !moved(call)),
  );
  assert.deepEqual(generatedCalls.filter(moved), currentCalls.filter(moved));
  assert.ok(currentCalls.includes("wp plugin deactivate lombardi-contact --quiet"));
});

// The differences are the input to phase 3, which replaces Lombardi's copy.
test("Lombardi's manifest renders Lombardi's deploy script apart from the moved steps", async () => {
  const path = "deploy/ploi/admin.sh";
  const diff = unifiedDiff(
    path,
    await readFixture(`lombardi/${path}`),
    await generatedScript(LOMBARDI),
  );

  assert.equal(`${diff.join("\n")}\n`, await readFixture("lombardi-phase-3/admin.sh.diff"));
});

test("gq new writes the deploy script and the deploy extension directory", async () => {
  const site = await newSite();

  const script = await readSite(site.root, "deploy/ploi/admin.sh");
  assert.equal((await lstat(join(site.root, "deploy/ploi/admin.sh"))).mode & 0o777, 0o755);
  assert.match(script, /^ {2}for plugin in getquick-design gq-support .* safe-svg; do$/mu);
  assert.match(script, /^ {4}echo "ACME_DEPLOY_STATUS=success SHA=\$deployed_sha"$/mu);
  assert.match(
    await readSite(site.root, "deploy/ploi/admin.d/README.md"),
    /^# CMS deploy extensions$/mu,
  );
  const lock = JSON.parse(await readSite(site.root, "gq.lock.json"));
  assert.equal(lock.files["deploy/ploi/admin.sh"], hash(script));
  assert.ok(lock.created.includes("deploy/ploi/admin.d/README.md"));

  // It activates the CMS skeleton's plugins, then its theme extension
  // activates getquick-theme.
  const extension = "deploy/ploi/admin.d/10-theme.sh";
  const result = await deploy(script, {
    releaseFiles: { [extension]: await readSite(site.root, extension) },
  });
  assert.equal(result.code, 0, result.output);
  const { plugins } = JSON.parse(await readSite(site.root, "gq.ops.json")).wordpress;
  assert.deepEqual(
    wpCalls(result.calls, "plugin activate").map(([, , , plugin]) => plugin),
    plugins,
  );
  assert.deepEqual(wpCalls(result.calls, "theme activate"), [
    ["wp", "theme", "activate", "getquick-theme"],
  ]);
});

test("listing a plugin in gq.ops.json makes gq sync add it to the deploy script", async () => {
  const site = await newSite();
  const manifest = JSON.parse(await readSite(site.root, "gq.ops.json"));
  await writeFile(
    join(site.root, "gq.ops.json"),
    `${JSON.stringify({ ...manifest, wordpress: { plugins: ["wp-graphql", "acme-blocks"] } }, null, 2)}\n`,
  );

  const check = await site.run(["sync", "--check"]);
  assert.equal(check.code, 1);
  assert.match(check.stdout, /^deploy\/ploi\/admin\.sh: pending, gq sync would update it\.$/mu);
  const sync = await site.run(["sync"]);
  assert.equal(sync.code, 0, sync.stderr);

  const script = await readSite(site.root, "deploy/ploi/admin.sh");
  assert.match(script, /^ {2}for plugin in wp-graphql acme-blocks; do$/mu);
  const result = await deploy(script);
  assert.deepEqual(
    wpCalls(result.calls, "plugin activate").map(([, , , plugin]) => plugin),
    ["wp-graphql", "acme-blocks"],
  );
});

test("gq sync leaves the deploy extensions alone, and doesn't restore a deleted directory", async () => {
  const site = await newSite();
  await writeFile(join(site.root, "deploy/ploi/admin.d/10-site.sh"), "wp theme activate acme\n");
  await writeFile(join(site.root, "deploy/ploi/admin.d/README.md"), "# Ours now\n");

  assert.equal((await site.run(["sync", "--check"])).code, 0);
  assert.equal(await readSite(site.root, "deploy/ploi/admin.d/README.md"), "# Ours now\n");

  await rm(join(site.root, "deploy/ploi/admin.d"), { recursive: true });
  const sync = await site.run(["sync"]);
  assert.equal(sync.code, 0, sync.stderr);
  await assert.rejects(access(join(site.root, "deploy/ploi/admin.d")), { code: "ENOENT" });
});

test("a plugin that isn't a plugin slug is refused before gq sync writes anything", async () => {
  for (const plugin of ["acme blocks", "acme;reboot", "$(reboot)", "-acme", "../acme"]) {
    const fixture = await createFixtureSite({
      ops: { ...ACME, wordpress: { plugins: ["wp-graphql", plugin] } },
    });

    const result = await fixture.run(["sync"]);

    assert.equal(result.code, 1, plugin);
    assert.equal(
      result.stderr,
      "gq: gq.ops.json is invalid: wordpress.plugins[1] must be a plugin slug " +
        "(letters, digits, -, _ and ., starting with a letter or digit).\n",
    );
    await assert.rejects(access(fixture.path("deploy/ploi/admin.sh")), { code: "ENOENT" });
  }
});
