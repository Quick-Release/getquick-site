import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { temporaryDirectory } from "../support/fixture-site.mjs";
import { findProjectConfig, loadProjectContext } from "../../src/ops/project-context.mjs";

test("discovers the project config from a nested working directory", async () => {
  const root = await temporaryDirectory();
  const nested = join(root, "apps", "web");
  await mkdir(nested, { recursive: true });
  await writeFile(
    join(root, "gq.ops.json"),
    '{"schemaVersion":1,"project":"discovered","variant":"content"}\n',
  );

  assert.equal(await findProjectConfig(nested), join(root, "gq.ops.json"));
  const context = await loadProjectContext({ cwd: nested, env: {} });
  assert.equal(context.projectRoot, root);
  assert.equal(context.config.project, "discovered");
  assert.equal(context.resolvePath("deploy/site.sh"), join(root, "deploy", "site.sh"));
});

test("merges machine, project, and process environment in increasing precedence", async () => {
  const root = await temporaryDirectory();
  const configHome = join(root, "machine");
  await mkdir(join(configHome, "gq"), { recursive: true });
  await writeFile(
    join(root, "gq.ops.json"),
    '{"schemaVersion":1,"project":"env-test","variant":"content"}\n',
  );
  await writeFile(join(configHome, "gq", "ops.env"), "SOURCE=machine\nMACHINE_ONLY=yes\n");
  await writeFile(join(root, ".env"), "SOURCE=project\nPROJECT_ONLY=yes\n");

  const context = await loadProjectContext({
    cwd: root,
    env: { XDG_CONFIG_HOME: configHome, SOURCE: "process" },
  });

  assert.equal(context.env.SOURCE, "process");
  assert.equal(context.env.MACHINE_ONLY, "yes");
  assert.equal(context.env.PROJECT_ONLY, "yes");
});

test("does not inherit configuration across a nested Git repository", async () => {
  const root = await temporaryDirectory();
  const nestedRepository = join(root, "untrusted");
  await mkdir(join(nestedRepository, ".git"), { recursive: true });
  await writeFile(
    join(root, "gq.ops.json"),
    '{"schemaVersion":1,"project":"parent","variant":"content"}\n',
  );

  assert.equal(await findProjectConfig(nestedRepository), null);
});

test("fails clearly outside a configured project", async () => {
  const root = await temporaryDirectory();
  await assert.rejects(loadProjectContext({ cwd: root, env: {} }), /No gq\.ops\.json found/);
});
