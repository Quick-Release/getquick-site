// Offboarding a Site (ADR 0011): when a client leaves, `gq offboard` cuts
// every public URL and every credential gq made for it, losing no content or
// code, and records `offboarded` in gq.ops.json, which turns on the guards
// (guard.mjs) that keep anything from exposing it again. Reversible:
// `gq offboard --restore` brings everything back and removes the record.
// Both print the plan (✓ done, - to cut or + to restore, ! by hand), then act
// after confirmation, and only on what is still to do, so either can be run
// again after a failure.
//
//   gq offboard [--dry-run] [--yes]
//   gq offboard --restore [--dry-run] [--yes]

import { createReporter } from "../cli/reporter.mjs";
import { runPlan } from "./plan.mjs";
import { withOffboardingProviders } from "./providers.mjs";
import { cutPlan, inspectSite, restorePlan } from "./steps.mjs";

// Command → [usage, the options it accepts, runner].
const OFFBOARD_COMMANDS = new Map([
  [
    "offboard",
    ["gq offboard [--restore] [--dry-run] [--yes]", ["restore", "dryRun", "yes"], runOffboard],
  ],
]);

export const OFFBOARD_USAGE = [...OFFBOARD_COMMANDS.values()].map(([usage]) => usage);

export function offboardCommandOptions(command) {
  return OFFBOARD_COMMANDS.get(command.join(" "))?.[1];
}

export function isOffboardCommand(command) {
  return OFFBOARD_COMMANDS.has(command.join(" "));
}

// Resolves to the command's exit code.
export function runOffboardCommand(command, dependencies) {
  const [, , runner] = OFFBOARD_COMMANDS.get(command.join(" "));
  return runner(dependencies);
}

// `gq offboard [--restore] [--dry-run] [--yes]`. Resolves to an exit code.
async function runOffboard(dependencies) {
  const { context, parsed, io, interactive } = dependencies;
  const ops = context.config;
  if (parsed.restore && ops.offboarded?.phase === "archived") {
    throw new Error(
      `${ops.project} was archived (gq.ops.json offboarded.phase): its infrastructure is deleted, so there is nothing to restore.`,
    );
  }
  const ui = createReporter(io, interactive);
  ui.intro(`${parsed.restore ? "Restore" : "Offboard"} · ${ops.project}`);
  return withOffboardingProviders(dependencies, async (providers) => {
    const site = await inspectSite(providers);
    const options = { configPath: context.configPath };
    if (parsed.restore) {
      return runPlan(restorePlan(site, options), providers, {
        ui,
        parsed,
        todoSymbol: "+",
        question: `Restore ${ops.project}'s public access and credentials?`,
        nothing: `Nothing to restore: ${ops.project} is not offboarded.`,
        finished: `Restored ${ops.project}. Commit gq.ops.json, then deploy as usual.`,
      });
    }
    return runPlan(cutPlan(site, options), providers, {
      ui,
      parsed,
      todoSymbol: "-",
      question: `Cut ${ops.project}'s public access and credentials? (gq offboard --restore undoes it.)`,
      nothing: `Nothing left to cut: ${ops.project} is offboarded.`,
      finished: `Offboarded ${ops.project}. Commit gq.ops.json: its offboarded record keeps gq from exposing the Site again.`,
    });
  });
}
