// Shows an offboarding plan (steps.mjs's items), then applies its "todo"
// items in order after confirmation: a prompt in a terminal, --yes
// elsewhere, as `gq ploi provision` does. --dry-run stops after the plan.

const SYMBOLS = { done: "✓", manual: "!" };

// `todoSymbol` marks what this run would do ("-" to cut, "+" to restore);
// `question` is the confirmation prompt; `nothing` and `finished` the outros.
// Resolves to an exit code.
export async function runPlan(
  items,
  providers,
  { ui, parsed, todoSymbol, question, nothing, finished },
) {
  ui.note(
    items
      .map(({ state, area, text }) => `${SYMBOLS[state] ?? todoSymbol} ${area}: ${text}`)
      .join("\n"),
    "Plan",
  );
  const pending = items.filter(({ state }) => state === "todo");
  if (parsed.dryRun) {
    ui.outro("Dry run: nothing changed.");
    return 0;
  }
  if (pending.length === 0) {
    ui.outro(nothing);
    return 0;
  }
  if (!parsed.yes) {
    if (!ui.interactive) {
      throw new Error("Not a TTY: re-run with --yes to apply, or --dry-run to inspect.");
    }
    if (!(await ui.confirm(question))) {
      ui.outro("Nothing changed.");
      return 0;
    }
  }
  for (const { area, text, apply } of pending) {
    ui.step(`${area}: ${text}`);
    await apply(providers);
  }
  ui.outro(finished);
  return 0;
}
