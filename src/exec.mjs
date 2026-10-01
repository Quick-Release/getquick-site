import { spawn } from "node:child_process";

// The real `exec` for run(): runs a command without a shell, optionally
// writing `input` to its stdin, and resolves with its exit code and output.
// Given `stdout`/`stderr` streams, it also forwards the output as it arrives,
// for long commands the user watches (a release's checks, commits, pushes).
export function exec(command, args, { cwd, env, input, stdout: liveOut, stderr: liveErr } = {}) {
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
