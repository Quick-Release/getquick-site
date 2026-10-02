#!/usr/bin/env node

// Publishes the tagged version to npm. It re-runs itself under `sigillo run`
// for the `operations` environment, so NPM_TOKEN exists only in that child's
// environment: npm reads it through a throwaway userconfig that holds the
// `${NPM_TOKEN}` placeholder, never the token.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const reentry = "GQ_SIGILLO_REENTRY";
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

if (process.env[reentry] !== "1" || process.env.SIGILLO !== "1") {
  if (output("git", ["status", "--porcelain"]) !== "") {
    throw new Error("Commit or stash your changes before publishing.");
  }
  const tags = output("git", ["tag", "--points-at", "HEAD"]).split("\n");
  if (!tags.includes(`v${version}`)) {
    throw new Error(`HEAD is not tagged v${version}; tag the release commit first.`);
  }
  run("pnpm", ["check"]);

  const { sigillo } = JSON.parse(readFileSync(join(root, "gq.ops.json"), "utf8"));
  run(
    join(root, "node_modules", ".bin", "sigillo"),
    [
      "run",
      "--api-url",
      sigillo.apiUrl,
      "--project",
      sigillo.projectId,
      "--env",
      sigillo.environments.operations,
      "--",
      process.execPath,
      scriptPath,
    ],
    { env: { ...process.env, [reentry]: "1" } },
  );
} else {
  if (!process.env.NPM_TOKEN) throw new Error("NPM_TOKEN is missing from Sigillo operations.");
  const directory = mkdtempSync(join(tmpdir(), "gq-site-publish-"));
  const userconfig = join(directory, "npmrc");
  try {
    writeFileSync(userconfig, "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n", { mode: 0o600 });
    run("npm", ["publish", "--access", "public"], {
      env: { ...process.env, NPM_CONFIG_USERCONFIG: userconfig },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
