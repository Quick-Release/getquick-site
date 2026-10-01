import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { composerInstall } from "../src/cms/local.mjs";
import {
  syncLocalDesign,
  withDesignRegistryInstall,
  withLinkedLocalDesign,
} from "../src/cms/local-design.mjs";
import { exec } from "../src/exec.mjs";

function fixture(t) {
  // Real path: macOS's tmpdir() is a /var symlink to /private/var, and the
  // links under test store resolved paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "getquick-design-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cms = join(root, "apps/cms");
  const source = join(root, "design checkout");
  const plugin = join(cms, "web/app/plugins/getquick-design");
  const state = join(cms, ".local-plugins");
  const backup = join(state, "getquick-design-release");
  const config = join(state, "config.json");
  mkdirSync(source, { recursive: true });
  mkdirSync(plugin, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(source, "getquick-design.php"), "local edits");
  writeFileSync(join(plugin, "getquick-design.php"), "registry release");
  writeFileSync(config, JSON.stringify({ getquickDesign: source }));
  writeFileSync(join(root, "gq.ops.json"), "{}");
  return { root, cms, source, plugin, state, backup, config };
}

const local = { CI: "" };

test("startup links the checkout, preserves the release, and generates local DDEV files", (t) => {
  const f = fixture(t);
  assert.equal(syncLocalDesign(f.cms, local), true);
  assert.equal(readlinkSync(f.plugin), f.source);
  assert.equal(readFileSync(join(f.backup, "getquick-design.php"), "utf8"), "registry release");
  const compose = readFileSync(
    join(f.cms, ".ddev/docker-compose.getquick-design.local.yaml"),
    "utf8",
  );
  assert.ok(compose.includes(`source: ${JSON.stringify(f.source)}`));
  assert.ok(compose.includes(`target: ${JSON.stringify(f.source)}`));
  assert.match(compose, /read_only: true/u);
  assert.match(
    readFileSync(join(f.cms, ".ddev/config.getquick-design.local.yaml"), "utf8"),
    /pre-start:[\s\S]*exec-host: node .*cms-local-design.mjs[\s\S]*post-start:[\s\S]*exec-host: node .*cms-local-design.mjs refresh/u,
  );
  assert.equal(syncLocalDesign(f.cms, local), true);
  assert.equal(readFileSync(join(f.source, "getquick-design.php"), "utf8"), "local edits");
});

test("Composer sees only the registry copy and its updated release is preserved after relinking", async (t) => {
  const f = fixture(t);
  syncLocalDesign(f.cms, local);
  const result = await withDesignRegistryInstall(
    f.cms,
    () => {
      assert.equal(lstatSync(f.plugin).isSymbolicLink(), false);
      assert.equal(existsSync(f.backup), false);
      writeFileSync(join(f.plugin, "getquick-design.php"), "updated registry release");
      return 123;
    },
    { env: local },
  );
  assert.equal(result, 123);
  assert.equal(readlinkSync(f.plugin), f.source);
  assert.equal(
    readFileSync(join(f.backup, "getquick-design.php"), "utf8"),
    "updated registry release",
  );
  assert.equal(readFileSync(join(f.source, "getquick-design.php"), "utf8"), "local edits");
});

test("Composer failure relinks, refreshes metadata under the lock, and propagates the original error", async (t) => {
  const f = fixture(t);
  syncLocalDesign(f.cms, local);
  const failure = new Error("Composer failed");
  let refreshed = false;
  await assert.rejects(
    () =>
      withDesignRegistryInstall(
        f.cms,
        () => {
          throw failure;
        },
        {
          env: local,
          afterRelink: () => {
            assert.equal(readlinkSync(f.plugin), f.source);
            assert.throws(() => syncLocalDesign(f.cms, local), /Another local Design operation/u);
            refreshed = true;
          },
        },
      ),
    (error) => error === failure,
  );
  assert.equal(refreshed, true);
  assert.equal(syncLocalDesign(f.cms, local), true);
});

test("a failed first install that leaves no directory still restores the source link", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    () =>
      withDesignRegistryInstall(
        f.cms,
        () => {
          rmSync(f.plugin, { recursive: true });
          throw new Error("failed install");
        },
        { env: local },
      ),
    /failed install/u,
  );
  assert.equal(readlinkSync(f.plugin), f.source);
  assert.equal(readFileSync(join(f.source, "getquick-design.php"), "utf8"), "local edits");
});

test("CI ignores even a configured override and staging without opt-in stays untouched", async (t) => {
  const f = fixture(t);
  assert.equal(syncLocalDesign(f.cms, { CI: "true" }), false);
  assert.equal(
    await withDesignRegistryInstall(f.cms, () => "ci ran", { env: { CI: "true" } }),
    "ci ran",
  );
  assert.equal(lstatSync(f.plugin).isSymbolicLink(), false);
  assert.equal(existsSync(join(f.cms, ".ddev")), false);
  rmSync(f.config);
  assert.equal(syncLocalDesign(f.cms, local), false);
  assert.equal(
    await withDesignRegistryInstall(f.cms, () => "staging ran", { env: local }),
    "staging ran",
  );
  assert.equal(lstatSync(f.plugin).isSymbolicLink(), false);
});

test("a disabled or missing opt-in never hands an existing source symlink to Composer", async (t) => {
  const f = fixture(t);
  syncLocalDesign(f.cms, local);
  const action = () => assert.fail("Composer must not receive the source symlink");
  await assert.rejects(
    () => withDesignRegistryInstall(f.cms, action, { env: { CI: "true" } }),
    /without an active local override/u,
  );
  rmSync(f.config);
  await assert.rejects(
    () => withDesignRegistryInstall(f.cms, action, { env: local }),
    /without an active local override/u,
  );
  assert.equal(readlinkSync(f.plugin), f.source);
  assert.equal(readFileSync(join(f.source, "getquick-design.php"), "utf8"), "local edits");
});

test("invalid or missing source configuration cannot modify the installed plugin", (t) => {
  const f = fixture(t);
  writeFileSync(f.config, JSON.stringify({ getquickDesign: "relative/path" }));
  assert.throws(() => syncLocalDesign(f.cms, local), /absolute/u);
  writeFileSync(
    f.config,
    JSON.stringify({ getquickDesign: join(f.cms, "web/app/plugins/getquick-design") }),
  );
  assert.throws(() => syncLocalDesign(f.cms, local), /outside apps\/cms/u);
  writeFileSync(f.config, JSON.stringify({ getquickDesign: join(f.root, "missing") }));
  assert.throws(() => syncLocalDesign(f.cms, local), /ENOENT/u);
  assert.equal(lstatSync(f.plugin).isSymbolicLink(), false);
  assert.equal(readFileSync(join(f.plugin, "getquick-design.php"), "utf8"), "registry release");
});

test("unexpected symlinks and ambiguous backups are refused rather than overwritten", async (t) => {
  const f = fixture(t);
  mkdirSync(f.backup);
  assert.throws(() => syncLocalDesign(f.cms, local), /Both the installed/u);
  rmSync(f.plugin, { recursive: true });
  symlinkSync(join(f.root, "some-other-checkout"), f.plugin);
  await assert.rejects(
    () => withDesignRegistryInstall(f.cms, () => assert.fail("must not run"), { env: local }),
    /different plugin symlink/u,
  );
  assert.equal(readlinkSync(f.plugin), join(f.root, "some-other-checkout"));
});

test("symlinked destination ancestors cannot turn the checkout into a registry install", async (t) => {
  const f = fixture(t);
  const source = join(f.root, "getquick-design");
  renameSync(f.source, source);
  writeFileSync(f.config, JSON.stringify({ getquickDesign: source }));
  const plugins = join(f.cms, "web/app/plugins");
  rmSync(plugins, { recursive: true });
  symlinkSync(f.root, plugins);
  await assert.rejects(
    () => withDesignRegistryInstall(f.cms, () => assert.fail("must not run"), { env: local }),
    /unsafe local plugin ancestor/u,
  );
  assert.equal(readFileSync(join(source, "getquick-design.php"), "utf8"), "local edits");
  assert.equal(lstatSync(source).isSymbolicLink(), false);
});

test("startup recovers a dead owner only after its Composer child has also exited", (t) => {
  const f = fixture(t);
  const dead = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" }).pid;
  const lock = join(f.state, "design-operation.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: dead, host: hostname() }));
  writeFileSync(join(lock, "command.pid"), String(process.pid));
  assert.throws(() => syncLocalDesign(f.cms, local), /child is still alive/u);
  assert.equal(lstatSync(f.plugin).isSymbolicLink(), false);
  writeFileSync(join(lock, "command.pid"), String(dead));
  assert.equal(syncLocalDesign(f.cms, local), true);
  assert.equal(readlinkSync(f.plugin), f.source);
  assert.equal(existsSync(lock), false);
  assert.equal(readFileSync(join(f.source, "getquick-design.php"), "utf8"), "local edits");
});

test("DDEV autoload refresh holds the same lock as dependency changes", async (t) => {
  const f = fixture(t);
  await withLinkedLocalDesign(
    f.cms,
    async () => {
      assert.equal(readlinkSync(f.plugin), f.source);
      await assert.rejects(
        () => withDesignRegistryInstall(f.cms, () => assert.fail("must not run"), { env: local }),
        /Another local Design operation/u,
      );
    },
    local,
  );
  assert.equal(existsSync(join(f.state, "design-operation.lock")), false);
});

// db sync's composer.lock install, through the real exec and a fake host
// Composer (Lombardi's cms-composer CLI test, for the install action).
test("composerInstall restores the link and fails with Composer's exit status", async (t) => {
  const f = fixture(t);
  syncLocalDesign(f.cms, local);
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  const log = join(f.root, "composer.log");
  writeFileSync(
    join(bin, "composer"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.COMPOSER_TEST_LOG, JSON.stringify(args) + '\\n');
const plugin = 'web/app/plugins/getquick-design';
if (args[0] === 'dump-autoload') {
  if (!fs.lstatSync(plugin).isSymbolicLink() || !fs.existsSync('.local-plugins/design-operation.lock')) process.exit(99);
} else {
  if (fs.lstatSync(plugin).isSymbolicLink()) process.exit(98);
  fs.writeFileSync(plugin + '/getquick-design.php', 'partially updated registry release');
  process.exit(23);
}
`,
    { mode: 0o755 },
  );
  await assert.rejects(
    composerInstall(f.cms, {
      exec,
      env: {
        ...process.env,
        CI: "",
        COMPOSER_AUTH: "{}",
        COMPOSER_TEST_LOG: log,
        PATH: `${bin}:${process.env.PATH}`,
      },
    }),
    /Composer failed \(exit 23\)/u,
  );
  assert.deepEqual(
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    [
      ["install", "--no-interaction"],
      ["dump-autoload", "--no-scripts"],
    ],
  );
  assert.equal(readlinkSync(f.plugin), f.source);
  assert.equal(readFileSync(join(f.source, "getquick-design.php"), "utf8"), "local edits");
  assert.equal(
    readFileSync(join(f.backup, "getquick-design.php"), "utf8"),
    "partially updated registry release",
  );
});
