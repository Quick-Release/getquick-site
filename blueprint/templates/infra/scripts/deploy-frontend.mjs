#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const alchemy = process.platform === "win32" ? "alchemy.cmd" : "alchemy";
// Public deploy configuration lives in gq.ops.json; only the API token comes
// from Sigillo/CI. Without PUBLIC_WORDPRESS_GRAPHQL_URL the frontend would
// fall back to the local DDEV endpoint, so it is always set here.
const ops = JSON.parse(readFileSync(new URL("../../gq.ops.json", import.meta.url), "utf8"));

// A Frontend with the publication store (apps/frontend/migrations) is
// refreshed with FRONTEND_REFRESH_TOKEN from Sigillo staging, bound to the
// Worker as a secret. Deploying without it disables refresh, not serving.
if (existsSync(new URL("../../apps/frontend/migrations", import.meta.url))) {
  const token = process.env.FRONTEND_REFRESH_TOKEN?.trim();
  if (token && token.length < 32) {
    console.error(
      "FRONTEND_REFRESH_TOKEN must be at least 32 characters; the Frontend refuses shorter ones.",
    );
    process.exit(1);
  }
  if (!token) {
    console.warn(
      "FRONTEND_REFRESH_TOKEN isn't set: this deploy disables gq frontend refresh. " +
        "What the publication store holds is still served. Add it to Sigillo staging to refresh.",
    );
  }
}

const result = spawnSync(
  alchemy,
  [
    "deploy",
    "--stage",
    "prod",
    "--config",
    "frontend.run.ts",
    "--yes",
    "--no-input",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || ops.cloudflare.accountId,
      PUBLIC_WORDPRESS_GRAPHQL_URL:
        process.env.PUBLIC_WORDPRESS_GRAPHQL_URL || `https://${ops.domains.admin}/wp/graphql`,
    },
  },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
