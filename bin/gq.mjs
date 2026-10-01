#!/usr/bin/env node

import { lookup } from "node:dns/promises";

import { exec } from "../src/exec.mjs";
import { run } from "../src/run.mjs";

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  fetch: globalThis.fetch,
  exec,
  lookup,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
});
