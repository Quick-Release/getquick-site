// `gq media check`: whether the site's WordPress uploads are hosted
// independently of its CMS (readiness.mjs). The production check runs
// through gq sigillo run staging, which injects the Ploi token, the media
// bucket's credentials and, for --upload, the CMS check user's application
// password; --local needs nothing and reaches no network. Exits 1 when not
// ready, so the result can gate a script.
//
//   gq media check [--upload | --local] [--json]

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CMS_PATH } from "../cms/local.mjs";
import { localMediaReadiness, productionMediaReadiness } from "./readiness.mjs";

export const MEDIA_USAGE = ["gq media check [--upload | --local] [--json]"];

const MARKS = { ok: "✓", "not-ready": "✗", warn: "⚠", skipped: "–" };

const SUMMARIES = {
  production: {
    ready:
      "Ready: uploads are hosted independently of the CMS, and an upload through it proved so.",
    configured:
      "Configured, not yet proven: run pnpm media:check:upload to upload through the CMS.",
    "not-ready":
      "Not ready: the production guarantee doesn't cover uploaded media until the ✗ checks pass.",
  },
  local: {
    ready:
      "Local development is ready (uploads on disk). That is not the production prerequisite: run pnpm media:check.",
    "not-ready": "Local development isn't ready: fix the ✗ checks.",
  },
};

export function isMediaCommand(command) {
  return command.join(" ") === "media check";
}

export function mediaCommandOptions(command) {
  return isMediaCommand(command) ? ["upload", "local"] : undefined;
}

// Resolves to the exit code: 0 when ready (or configured), 1 when not.
export async function runMediaCommand({ context, parsed, fetch, io }) {
  if (parsed.upload && parsed.local) {
    throw new Error("--upload checks the production CMS; --local checks this machine. Pick one.");
  }
  const result = parsed.local
    ? localMediaReadiness({
        ops: context.config,
        cmsEnv: await readIfPresent(join(context.projectRoot, CMS_PATH, ".env")),
      })
    : await productionMediaReadiness({
        ops: context.config,
        env: context.env,
        fetch,
        upload: Boolean(parsed.upload),
      });

  if (parsed.json) io.out(JSON.stringify(result, null, 2));
  else printResult(io, result);
  return result.status === "not-ready" ? 1 : 0;
}

function printResult(io, { scope, status, checks }) {
  io.out(`Independent media (${scope === "local" ? "local development" : "production"})`);
  for (const check of checks) {
    io.out(`  ${MARKS[check.status]} ${check.name}: ${check.detail}`);
    if (check.action && check.status !== "ok") io.out(`      → ${check.action}`);
  }
  io.out(SUMMARIES[scope][status]);
}

async function readIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
