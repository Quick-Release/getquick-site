import { log } from "@clack/prompts";
import { runCli } from "./ops/cli.mjs";

// The whole CLI behind one in-process call: every provider request goes
// through `fetch`, every child process through `exec`, and every value a
// command needs from its surroundings comes from `cwd` and `env`; no command
// reads the process's own environment or directory. bin/gq.mjs is the only
// caller that wires in the real ones. Resolves to the process exit code.
export async function run(
  argv,
  {
    cwd,
    env = {},
    fetch = unavailable("fetch"),
    exec = unavailable("exec"),
    stdout,
    stderr,
    interactive = false,
  } = {},
) {
  if (typeof cwd !== "string" || cwd === "") throw new TypeError("run() requires a cwd.");
  if (typeof stdout?.write !== "function" || typeof stderr?.write !== "function") {
    throw new TypeError("run() requires stdout and stderr streams.");
  }
  const io = {
    stdout,
    stderr,
    out: (line) => stdout.write(`${line}\n`),
    err: (line) => stderr.write(`${line}\n`),
  };

  try {
    await runCli(argv, { cwd, env, fetch, exec, io, interactive });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (interactive) log.error(message);
    else io.err(`gq: ${message}`);
    return 1;
  }
}

function unavailable(name) {
  return () => {
    throw new Error(`run() was called without ${name}, and this command needs it.`);
  };
}
