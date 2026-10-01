import { spawn } from "node:child_process";
import { constants } from "node:os";

// The real `exec` for run(): runs a command without a shell, optionally
// writing `input` to its stdin, and resolves with its exit code and output.
// Given `stdout`/`stderr` streams, it also forwards the output as it arrives,
// for long commands the user watches (a release's checks, commits, pushes).
// With `stdio: "inherit"` the child gets the terminal itself, for commands
// that prompt or read stdin (a wrapped command, `sigillo login`); nothing is
// captured then, and a child killed by a signal exits 128 + its number.
export function exec(
  command,
  args,
  { cwd, env, input, stdio, stdout: liveOut, stderr: liveErr } = {},
) {
  if (stdio === "inherit") return execInherited(command, args, { cwd, env });

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
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

function execInherited(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
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
