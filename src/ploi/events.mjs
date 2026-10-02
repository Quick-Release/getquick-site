// Gives the Ploi site's CMS the key it signs its publication events with
// (PUBLICATION_EVENT_SECRET, from the secret store): the same per-Site secret
// `pnpm deploy:frontend` and CI releases bind to the Frontend, so the
// Frontend accepts this CMS's events and no other's. Sets that one .env line
// and leaves every other as it is; never shows the value. Idempotent.
//
//   gq ploi events [--dry-run]

import { applyEnv } from "../dotenv.mjs";
import { createReporter } from "../reporter.mjs";
import { createPloiServerClient } from "./server-client.mjs";

export const EVENT_SECRET = "PUBLICATION_EVENT_SECRET";

// `gq ploi events [--dry-run]`. Resolves to an exit code.
export async function runEvents({ context, parsed, fetch, io, interactive }) {
  const ops = context.config;
  if (!ops.ploi?.siteId) throw new Error("gq.ops.json ploi.siteId is required.");
  const secret = context.env[EVENT_SECRET]?.trim();
  if (!secret) {
    throw new Error(
      `${EVENT_SECRET} is missing; add it to Sigillo staging (openssl rand -hex 32) and run this through gq sigillo run staging.`,
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `${EVENT_SECRET} must be at least 32 characters; the Frontend refuses shorter ones.`,
    );
  }

  const ui = createReporter(io, interactive);
  ui.intro("Ploi .env · publication events");
  const client = createPloiServerClient({
    token: context.env.PLOI_API_TOKEN,
    serverId: ops.ploi.serverId,
    fetch,
  });
  const envPath = `/sites/${ops.ploi.siteId}/env`;
  const response = await client.request("GET", envPath);
  const current = response?.data ?? response?.env;
  if (typeof current !== "string" || !current.trim()) {
    throw new Error("The Ploi site has no .env yet; run gq ploi provision first.");
  }

  const { output, changed } = applyEnv(current, { [EVENT_SECRET]: secret });
  if (changed.length === 0) {
    ui.outro(`The Ploi .env already has this Site's ${EVENT_SECRET}.`);
    return 0;
  }
  ui.note(changed.map((name) => `~ ${name}`).join("\n"), "Plan (values not shown)");
  if (parsed.dryRun) {
    ui.outro("Dry run: nothing changed.");
    return 0;
  }
  await client.request("PATCH", envPath, { content: output });
  ui.outro(
    "Updated. The next release copies the .env into the CMS; then `wp gq-events check` there proves the Frontend accepts its events.",
  );
  return 0;
}
