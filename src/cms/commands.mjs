import { join } from "node:path";

import { loadProjectContext } from "../ops/project-context.mjs";
import { runComposerCommand } from "./composer.mjs";
import { runDdevCommand } from "./ddev.mjs";
import { runDesignCommand, syncLocalDesign, withLinkedLocalDesign } from "./local-design.mjs";
import { CMS_PATH } from "./local.mjs";

// The site's local CMS: DDEV startup (in the background by default), Composer
// with whichever PHP is at hand, and the entry the local Design override's
// generated DDEV hooks run. Like the Sigillo wrapper, these parse their own
// arguments: whatever gq doesn't use goes to DDEV or Composer as is.
// Action → [usage, runner(args, dependencies)].
const CMS_COMMANDS = new Map([
  [
    "start",
    [
      "gq cms start [--foreground] [ddev start arguments...]",
      (args, dependencies) => runDdevCommand("start", args, dependencies),
    ],
  ],
  [
    "status",
    ["gq cms status", (args, dependencies) => runDdevCommand("status", args, dependencies)],
  ],
  [
    "stop",
    [
      "gq cms stop | describe [ddev arguments...]",
      (args, dependencies) => runDdevCommand("stop", args, dependencies),
    ],
  ],
  ["describe", [null, (args, dependencies) => runDdevCommand("describe", args, dependencies)]],
  [
    "composer",
    [
      "gq cms composer install | update | reinstall | test | lint | lint:fix [arguments...]",
      ([action, ...args], dependencies) => runComposerCommand(action, args, dependencies),
    ],
  ],
  [
    "design",
    ["gq cms design [refresh]", (args, dependencies) => runDesignHook(args, dependencies)],
  ],
]);

export const CMS_USAGE = [...CMS_COMMANDS.values()].map(([usage]) => usage).filter(Boolean);

export function isCmsCommand(argv) {
  return argv[0] === "cms";
}

// `argv` is everything after `gq cms`. Resolves to the exit code.
export async function runCmsCommand(argv, { cwd, env, exec, io, interactive }) {
  const [action, ...args] = argv;
  const command = CMS_COMMANDS.get(action);
  if (!command) {
    throw new Error(`Usage:\n${CMS_USAGE.map((usage) => `  ${usage}`).join("\n")}`);
  }
  const context = await loadProjectContext({ cwd, env });
  return command[1](args, { context, env, exec, io, interactive });
}

// The entry the Design override's generated DDEV hooks run: pre-start links
// the checkout; post-start rebuilds the autoload inside DDEV, holding the same
// lock as dependency changes.
async function runDesignHook(args, { context, env, exec, io }) {
  const cmsRoot = join(context.projectRoot, CMS_PATH);
  if (args.length === 1 && args[0] === "refresh") {
    const result = await withLinkedLocalDesign(
      cmsRoot,
      (override) =>
        runDesignCommand(
          exec,
          "ddev",
          ["exec", "composer", "dump-autoload", "--no-scripts"],
          override,
          { cwd: cmsRoot, env, stdio: "inherit" },
        ),
      env,
    );
    if (result && result.code !== 0) {
      throw new Error(`Autoload refresh failed (exit ${result.code}).`);
    }
    return 0;
  }
  if (args.length > 0) throw new Error("Use gq cms design (to link) or gq cms design refresh.");
  if (syncLocalDesign(cmsRoot, env)) {
    io.out("[Design] Local source linked; CI and staging remain registry-only.");
  }
  return 0;
}
