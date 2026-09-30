import {
  autocomplete,
  cancel,
  confirm,
  intro,
  isCancel,
  outro,
  select,
  spinner,
} from "@clack/prompts";

export async function chooseCommand(endpoints) {
  intro("gq operations");
  const command = await select({
    message: "What would you like to inspect?",
    options: [
      { value: "context", label: "Project context" },
      { value: "servers", label: "Ploi servers" },
      { value: "sites", label: "Ploi sites" },
      { value: "ploi-api", label: "Browse the Ploi API" },
      { value: "accounts", label: "Cloudflare accounts" },
      { value: "zones", label: "Cloudflare zones" },
      { value: "dns", label: "Cloudflare DNS records" },
    ],
  });
  if (isCancel(command)) return cancelled();

  if (command === "ploi-api") {
    const operation = await autocomplete({
      message: "Choose a Ploi operation",
      placeholder: "Search 225 operations…",
      maxItems: 10,
      options: endpoints.map((endpoint) => ({
        value: endpoint.id,
        label: endpoint.id,
        hint: `${endpoint.method} ${endpoint.path}`,
      })),
    });
    if (isCancel(operation)) return cancelled();
    outro("Operation selected");
    return ["ploi", "api", "describe", operation, "--json"];
  }

  outro("Running command");
  return {
    context: ["context", "show"],
    servers: ["ploi", "servers", "list"],
    sites: ["ploi", "sites", "list"],
    accounts: ["cloudflare", "accounts", "list"],
    zones: ["cloudflare", "zones", "list"],
    dns: ["cloudflare", "dns", "list"],
  }[command];
}

export async function confirmMutation({ operation, method, url }) {
  const answer = await confirm({
    message: `${method} ${url}\nRun ${operation}?`,
    initialValue: false,
  });
  if (isCancel(answer) || !answer) {
    cancel("Operation cancelled. No request was sent.");
    return false;
  }
  return true;
}

export async function withSpinner(message, callback, enabled) {
  if (!enabled) return callback();
  const progress = spinner();
  progress.start(message);
  try {
    const result = await callback();
    progress.stop("Done");
    return result;
  } catch (error) {
    progress.error("Failed");
    throw error;
  }
}

function cancelled() {
  cancel("Operation cancelled.");
  return null;
}
