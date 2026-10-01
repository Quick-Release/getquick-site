import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { constants } from "node:os";

// The real `exec` for run(): runs a command without a shell, optionally
// writing `input` to its stdin, and resolves with its exit code and output.
// Given `stdout`/`stderr` streams, it also forwards the output as it arrives,
// for long commands the user watches (a release's checks, commits, pushes).
// With `stdio: "inherit"` the child gets the terminal itself, for commands
// that prompt or read stdin (a wrapped command, `sigillo login`); nothing is
// captured then, and a child killed by a signal exits 128 + its number.
// `timeout` (milliseconds) stops a child that runs longer, which then fails.
// With `background: { log }` the child runs detached in its own process group,
// its output going to the file `log` (truncated), and the call resolves with
// its `pid` as soon as it has started, without waiting for it.
export function exec(
  command,
  args,
  { cwd, env, input, stdio, timeout, background, stdout: liveOut, stderr: liveErr } = {},
) {
  if (background) return execInBackground(command, args, { cwd, env, log: background.log });
  if (stdio === "inherit") return execInherited(command, args, { cwd, env, timeout });

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, timeout, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      liveOut?.write(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
      liveErr?.write(chunk);
    });
    // A child that exits without reading its input closes the pipe (EPIPE);
    // its exit code, not the write, is the result.
    child.stdin.on("error", () => {});
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input === undefined ? undefined : String(input));
  });
}

function execInherited(command, args, { cwd, env, timeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, timeout, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolve({
        code: code ?? (constants.signals[signal] ? 128 + constants.signals[signal] : 1),
        stdout: "",
        stderr: "",
      }),
    );
  });
}

async function execInBackground(command, args, { cwd, env, log }) {
  const output = openSync(log, "w", 0o600);
  try {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", output, output],
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return { code: 0, stdout: "", stderr: "", pid: child.pid };
  } finally {
    closeSync(output);
  }
}
