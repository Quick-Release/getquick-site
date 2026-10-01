import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { exec } from "../src/exec.mjs";

test("exec returns the exit code and output of a child that ignores its input", async () => {
  const result = await exec(process.execPath, ["-e", "console.log('ok'); process.exit(3)"], {
    input: "x".repeat(4 * 1024 * 1024),
  });
  assert.deepEqual(result, { code: 3, stdout: "ok\n", stderr: "" });
});

test("exec keeps multibyte characters split across output chunks", async () => {
  // 9 bytes a repeat, so 64 KiB pipe chunks end mid-character; the child builds
  // the text itself because Linux caps one argument at 128 KiB.
  const result = await exec(process.execPath, ["-e", "process.stdout.write('ção€'.repeat(50000))"]);
  assert.equal(result.stdout, "ção€".repeat(50_000));
});

test("exec forwards output to the given streams as well as returning it", async () => {
  const seen = { out: "", err: "" };
  const result = await exec(
    process.execPath,
    ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
    {
      stdout: { write: (chunk) => (seen.out += chunk) },
      stderr: { write: (chunk) => (seen.err += chunk) },
    },
  );
  assert.deepEqual(seen, { out: "out", err: "err" });
  assert.deepEqual(result, { code: 0, stdout: "out", stderr: "err" });
});

test("exec with inherited stdio returns the exit code without capturing output", async () => {
  const result = await exec(process.execPath, ["-e", "process.exit(4)"], { stdio: "inherit" });
  assert.deepEqual(result, { code: 4, stdout: "", stderr: "" });
});

test("exec with inherited stdio reports a child killed by a signal as 128 + its number", async () => {
  const result = await exec(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], {
    stdio: "inherit",
  });
  assert.equal(result.code, 143);
});

test("exec with a timeout stops a child that runs too long and reports a failure", async () => {
  const result = await exec(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
    timeout: 100,
  });
  assert.notEqual(result.code, 0);
});

test("exec in the background resolves with the PID of a detached child writing to a log", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "getquick-exec-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, "job.log");
  const result = await exec(process.execPath, ["-e", "console.error('err'); console.log('out')"], {
    background: { log },
  });
  assert.ok(Number.isInteger(result.pid) && result.pid > 0);
  assert.deepEqual({ ...result, pid: 0 }, { code: 0, stdout: "", stderr: "", pid: 0 });
  for (let attempt = 0; attempt < 250 && !/out\n/u.test(await readLog(log)); attempt++) {
    await sleep(20);
  }
  const output = await readLog(log);
  assert.match(output, /out\n/u);
  assert.match(output, /err\n/u);
});

test("exec in the background rejects when the log cannot be opened", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "getquick-exec-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    exec(process.execPath, ["-e", ""], { background: { log: directory } }),
    /EISDIR/u,
  );
});

async function readLog(path) {
  return readFile(path, "utf8").catch(() => "");
}
