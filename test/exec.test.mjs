import assert from "node:assert/strict";
import test from "node:test";
import { exec } from "../src/exec.mjs";

test("exec returns the exit code and output of a child that ignores its input", async () => {
  const result = await exec(process.execPath, ["-e", "console.log('ok'); process.exit(3)"], {
    input: "x".repeat(4 * 1024 * 1024),
  });
  assert.deepEqual(result, { code: 3, stdout: "ok\n", stderr: "" });
});

test("exec keeps multibyte characters split across output chunks", async () => {
  const text = "ção€".repeat(50_000);
  const result = await exec(process.execPath, [
    "-e",
    `process.stdout.write(${JSON.stringify(text)})`,
  ]);
  assert.equal(result.stdout, text);
});
