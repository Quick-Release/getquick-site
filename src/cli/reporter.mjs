import * as clack from "@clack/prompts";

// Progress output for the long-running commands (Ploi provisioning, releases):
// Clack's intro, spinners, notes and prompts on run()'s stdout in a terminal,
// and plain lines otherwise (CI logs, tests), where a spinner would only
// write cursor codes.
// `stdin` is where a terminal's answers come from (process.stdin otherwise).
export function createReporter(io, interactive, stdin) {
  if (interactive) {
    const output = io.stdout;
    return {
      interactive,
      intro: (title) => clack.intro(title, { output }),
      outro: (message) => clack.outro(message, { output }),
      note: (body, title) => clack.note(body, title, { output }),
      step: (message) => clack.log.step(message, { output }),
      info: (message) => clack.log.info(message, { output }),
      success: (message) => clack.log.success(message, { output }),
      warn: (message) => clack.log.warn(message, { output }),
      error: (message) => clack.log.error(message, { output }),
      cancel: (message) => clack.cancel(message, { output }),
      spinner: () => clack.spinner({ output }),
      async confirm(message) {
        const answer = await clack.confirm({ message, initialValue: true, output });
        return !clack.isCancel(answer) && answer === true;
      },
      // Resolves to what was typed, or undefined when cancelled.
      async text(message) {
        const answer = await clack.text({ message, input: stdin, output });
        return clack.isCancel(answer) ? undefined : answer;
      },
      // Resolves to what was typed, or undefined when cancelled.
      async password(message) {
        const answer = await clack.password({ message, output });
        return clack.isCancel(answer) ? undefined : answer;
      },
    };
  }

  return {
    interactive,
    intro: io.out,
    outro: io.out,
    note(body, title) {
      io.out(`${title}:`);
      for (const line of body.split("\n")) io.out(`  ${line}`);
    },
    step: io.out,
    info: io.out,
    success: io.out,
    warn: (message) => io.err(`warning: ${message}`),
    error: io.err,
    cancel: io.out,
    spinner: () => ({ start: io.out, message: io.out, stop: io.out, error: io.err }),
    async confirm() {
      throw new Error("Cannot ask for confirmation without a terminal.");
    },
    async text() {
      throw new Error("Cannot ask for an answer without a terminal.");
    },
    async password() {
      throw new Error("Cannot ask for a secret without a terminal.");
    },
  };
}
