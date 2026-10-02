// The token and bucket provisioning the `gq cloudflare` commands share
// (Lombardi's cloudflare-deploy-token.mjs and cloudflare-releases.mjs, which
// were both commands and libraries). Tokens are found by name, created when
// missing or inactive, and rolled when the secret store lost their value;
// Cloudflare never shows a token's value twice.

import { s3CredentialsFromToken } from "../r2.mjs";
import { createCloudflareAccountClient } from "./account-client.mjs";

const ONE_HOUR = 60 * 60 * 1000;

// The gq.ops.json Sigillo environment the provisioning commands store what
// they mint in (`gq cloudflare …`, `gq github setup`).
export const SECRETS_ENVIRONMENT = "staging";

// "GETQUICK <PROJECT> <purpose>": every token a command manages.
export function tokenName(project, purpose) {
  return `GETQUICK ${project.toUpperCase()} ${purpose}`;
}

// "ok" when the token exists and the secret store has its value; otherwise
// what to do.
export function planToken(existing, storeHasValue) {
  if (!existing) return "create";
  if (existing.status !== "active") return "create";
  return storeHasValue ? "ok" : "roll";
}

export function permissionGroups(names, groups) {
  const byName = new Map(groups.map((group) => [group.name, group.id]));
  return names.map((name) => {
    const id = byName.get(name);
    if (!id) throw new Error(`Cloudflare has no permission group named "${name}".`);
    return { id };
  });
}

export function accountPolicy(accountId, names, groups) {
  return {
    effect: "allow",
    resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
    permission_groups: permissionGroups(names, groups),
  };
}

export function zonePolicy(zoneId, names, groups) {
  return {
    effect: "allow",
    resources: { [`com.cloudflare.api.account.zone.${zoneId}`]: "*" },
    permission_groups: permissionGroups(names, groups),
  };
}

// Object read/write on one R2 bucket only.
export function bucketPolicies({ accountId, bucket }, groups) {
  return [
    {
      effect: "allow",
      resources: { [`com.cloudflare.edge.r2.bucket.${accountId}_default_${bucket}`]: "*" },
      permission_groups: permissionGroups(
        ["Workers R2 Storage Bucket Item Read", "Workers R2 Storage Bucket Item Write"],
        groups,
      ),
    },
  ];
}

// A token scoped to one bucket, whose S3 credentials go to
// `accessKeySecret` / `secretKeySecret`.
export function bucketTokenSpec({ name, accountId, bucket, accessKeySecret, secretKeySecret }) {
  return {
    name,
    secrets: [accessKeySecret, secretKeySecret],
    policies: (groups) => bucketPolicies({ accountId, bucket }, groups),
    values: async (token) => {
      const credentials = await s3CredentialsFromToken(token.id, token.value);
      return {
        [accessKeySecret]: credentials.accessKeyId,
        [secretKeySecret]: credentials.secretAccessKey,
      };
    },
  };
}

// Runs `work` with a client for a 1-hour token holding `policies`, and
// deletes the token afterwards whatever happens.
export async function withTemporaryToken(request, { name, accountId, policies, fetch }, work) {
  const temporary = await request("POST", "/tokens", {
    name,
    expires_on: new Date(Date.now() + ONE_HOUR).toISOString().replace(/\.\d{3}Z$/u, "Z"),
    policies,
  });
  try {
    return await work(createCloudflareAccountClient({ token: temporary.value, accountId, fetch }));
  } finally {
    await request("DELETE", `/tokens/${temporary.id}`);
  }
}

// Creates the R2 bucket when missing; resolves to "created" or "exists".
export async function ensureBucket(request, bucket) {
  const listed = await request("GET", `/r2/buckets?name_contains=${bucket}`);
  if ((listed.buckets ?? []).some((candidate) => candidate.name === bucket)) return "exists";
  await request("POST", "/r2/buckets", { name: bucket });
  return "created";
}

// Creates the bucket with a temporary token that can only manage buckets.
export function ensureBucketWithTemporaryToken(
  request,
  { accountId, bucket, project, purpose, fetch },
  groups,
) {
  return withTemporaryToken(
    request,
    {
      name: tokenName(project, `${purpose} bucket setup (temporary)`),
      accountId,
      policies: [accountPolicy(accountId, ["Workers R2 Storage Write"], groups)],
      fetch,
    },
    (setup) => ensureBucket(setup, bucket),
  );
}

// Each spec names a token, the secrets its value feeds, its `policies(groups)`
// and `values(token)` (secret → value). Resolves to one plan per spec.
export async function inspectTokens(request, secrets, specs) {
  const tokens = await request("GET", "/tokens?per_page=50");
  const stored = await secrets.list();
  return specs.map((spec) => {
    const existing = tokens.find((token) => token.name === spec.name);
    const hasSecrets = spec.secrets.every((secret) =>
      new RegExp(`\\b${secret}\\b`, "u").test(stored),
    );
    return { spec, existing, plan: planToken(existing, hasSecrets) };
  });
}

// Creates or rolls one planned token and stores its values; resolves to them
// (empty when the plan is "ok").
export async function applyToken(request, secrets, { spec, existing, plan }, groups) {
  if (plan === "ok") return {};
  const token =
    plan === "create"
      ? await request("POST", "/tokens", { name: spec.name, policies: spec.policies(groups) })
      : { id: existing.id, value: await request("PUT", `/tokens/${existing.id}/value`, {}) };
  const values = await spec.values(token);
  for (const [secret, value] of Object.entries(values)) await secrets.set(secret, value);
  return values;
}

// The token-manager token every `gq cloudflare` command authenticates with.
export function managerToken(context, command) {
  const token = context.env.CLOUDFLARE_TOKEN_MANAGER_API_TOKEN;
  if (!token) {
    throw new Error(
      `CLOUDFLARE_TOKEN_MANAGER_API_TOKEN is missing; run gq ${command} through gq sigillo run with the environment that holds it.`,
    );
  }
  return token;
}
