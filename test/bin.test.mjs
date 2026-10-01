import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import { createFixtureSite } from "./support/fixture-site.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const bin = join(packageRoot, "bin", "gq.mjs");

test("the gq bin runs run() with the real process", async () => {
  const fixture = await createFixtureSite();
  const { stdout } = await execFileAsync(process.execPath, [bin, "context", "show", "--json"], {
    cwd: fixture.path(),
    env: { PATH: process.env.PATH, PLOI_API_TOKEN: "from-the-process" },
  });
  const context = JSON.parse(stdout);
  assert.equal(context.projectRoot, fixture.root);
  assert.equal(context.ploiConfigured, true);

  const version = await execFileAsync(process.execPath, [bin, "--version"]);
  assert.equal(version.stdout, `${packageJson.version}\n`);
});

test("the gq bin exits 1 with the error on stderr", async () => {
  const fixture = await createFixtureSite();
  await assert.rejects(
    execFileAsync(process.execPath, [bin, "ploi", "servers", "list"], {
      cwd: fixture.root,
      env: { PATH: process.env.PATH },
    }),
    (error) => error.code === 1 && error.stderr === "gq: PLOI_API_TOKEN is required.\n",
  );
});

// A stand-in `sigillo` that does what `sigillo run` does for the wrapper: adds
// its routing and bootstrap variables, then runs everything after `--`.
const FAKE_SIGILLO = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const command = args.slice(args.indexOf("--") + 1);
const env = { ...process.env, SIGILLO: "1", SIGILLO_TOKEN: "bootstrap", INJECTED_SECRET: "from-sigillo" };
const result = spawnSync(command[0], command.slice(1), { env, stdio: "inherit" });
process.exit(result.status ?? 1);
`;

test("gq sigillo run re-enters the real bin and runs the command with injected secrets", async () => {
  const fixture = await createFixtureSite({
    ops: {
      schemaVersion: 1,
      project: "fixture",
      variant: "content",
      sigillo: {
        apiUrl: "https://secrets.example.test",
        projectId: "PROJECT123",
        environments: { local: "dev" },
      },
    },
    files: { "node_modules/.bin/sigillo": FAKE_SIGILLO, "apps/web/.keep": "" },
  });
  await chmod(fixture.path("node_modules/.bin/sigillo"), 0o755);
  const report =
    "const { SIGILLO_TOKEN, GQ_SIGILLO_REENTRY, INJECTED_SECRET } = process.env;" +
    "console.log(JSON.stringify({ cwd: process.cwd(), SIGILLO_TOKEN, GQ_SIGILLO_REENTRY, INJECTED_SECRET }));" +
    "process.exit(5)";

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [bin, "sigillo", "run", "local", "--", process.execPath, "-e", report],
      { cwd: fixture.path("apps/web"), env: { PATH: process.env.PATH } },
    ),
    (error) => {
      assert.equal(error.code, 5, error.stderr);
      assert.deepEqual(JSON.parse(error.stdout), {
        cwd: fixture.root,
        INJECTED_SECRET: "from-sigillo",
      });
      return true;
    },
  );
});

// Only bin/gq.mjs may hand the process's own cwd and environment to run().
test("no module under src reads process.env or process.cwd()", async () => {
  const sourceRoot = join(packageRoot, "src");
  const files = (await readdir(sourceRoot, { recursive: true })).filter((file) =>
    file.endsWith(".mjs"),
  );
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(join(sourceRoot, file), "utf8");
    assert.doesNotMatch(source, /process\.(env|cwd\b)/u, file);
  }
});
