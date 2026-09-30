import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
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
