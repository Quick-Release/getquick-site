import { spawn } from "node:child_process";

// The real `exec` for run(): runs a command without a shell, optionally
// writing `input` to its stdin, and resolves with its exit code and output.
export function exec(command, args, { cwd, env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    // A child that exits without reading its input closes the pipe (EPIPE);
    // its exit code, not the write, is the result.
    child.stdin.on("error", () => {});
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input === undefined ? undefined : String(input));
  });
}
