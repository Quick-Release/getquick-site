// The provider operations offboarding plans and applies against: Cloudflare
// (the project's tokens, Workers, custom domains, R2), the Ploi site and its
// crontab, the GitHub repository's webhooks, and the CMS database backup.
// Each offboarding command (`gq offboard`, `--restore`, and the archive that
// deletes) works through this one surface, so a step only says what it does,
// never how a provider is called.
//
// Credentials: the command runs through `gq sigillo run operations`, which
// injects the token-manager token. Tokens are managed with it; every other
// Cloudflare call goes through a 1-hour token it mints for this run and
// deletes afterwards (named "GETQUICK <PROJECT> offboarding (temporary)").
// Ploi's token and the releases bucket's R2 key live in Sigillo staging and
// are read into memory from there unless the environment already has them;
// GitHub goes through the operator's `gh` login. No value is printed.

import { runBackup } from "../db/sync.mjs";
import { createPloiServerClient } from "../ploi/server-client.mjs";
import { sigilloSecrets } from "../sigillo/commands.mjs";
import { createCloudflareAccountClient } from "../cloudflare/account-client.mjs";
import {
  accountPolicy,
  managerToken,
  SECRETS_ENVIRONMENT,
  tokenName,
  withTemporaryToken,
  zonePolicy,
} from "../cloudflare/tokens.mjs";

// What the run's temporary token may do: detach and attach Workers custom
// domains and switch workers.dev, and toggle the media bucket's domain.
export const offboardingAccountPermissions = [
  "Workers Scripts Read",
  "Workers Scripts Write",
  "Workers Routes Write",
  "Workers R2 Storage Write",
];
export const offboardingZonePermissions = ["Zone Read", "DNS Write", "Workers Routes Write"];

// The gq.ops.json keys offboarding reads, checked before anything runs.
const REQUIRED_KEYS = [
  ["domains.admin", (ops) => ops.domains?.admin],
  ["domains.frontend", (ops) => ops.domains?.frontend],
  ["ploi.serverId", (ops) => ops.ploi?.serverId],
  ["ploi.siteId", (ops) => ops.ploi?.siteId],
  ["ploi.systemUser", (ops) => ops.ploi?.systemUser],
  ["ploi.database", (ops) => ops.ploi?.database],
  ["backups.bucket", (ops) => ops.backups?.bucket],
  ["media.bucket", (ops) => ops.media?.bucket],
  ["media.domain", (ops) => ops.media?.domain],
  ["ci.worker", (ops) => ops.ci?.worker],
  ["cloudflare.accountId", (ops) => ops.cloudflare?.accountId],
  ["cloudflare.zoneId", (ops) => ops.cloudflare?.zoneId],
  ["github.repository", (ops) => ops.github?.repository],
];

// The production Frontend Worker, named as infra/frontend.run.ts names it.
export function frontendWorker(project) {
  return `${project}-fe`;
}

// Runs `work(providers)` with every provider connected, and deletes the
// temporary Cloudflare token afterwards whatever happens. `dependencies` are
// the run() seam's (context, env, fetch, exec, io, interactive).
export async function withOffboardingProviders(dependencies, work) {
  const { context, env, fetch, exec } = dependencies;
  const ops = context.config;
  const missing = REQUIRED_KEYS.filter(([, read]) => !read(ops)).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `gq.ops.json ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required to offboard.`,
    );
  }
  const accountId = ops.cloudflare.accountId;
  const manager = createCloudflareAccountClient({
    token: managerToken(context, "offboard"),
    accountId,
    fetch,
  });
  const staging = await sigilloSecrets({ context, env, exec }, SECRETS_ENVIRONMENT);
  const stagingSecret = async (name) => {
    const value = context.env[name]?.trim() || (await staging.get(name).catch(() => ""));
    if (!value) throw new Error(`${name} is missing in Sigillo ${staging.name}.`);
    return value;
  };

  const ploi = createPloiServerClient({
    token: await stagingSecret("PLOI_API_TOKEN"),
    serverId: ops.ploi.serverId,
    fetch,
  });
  // The manager token is never one of the project's tokens offboarding
  // disables, whatever it is named.
  const { id: managerId } = await manager("GET", "/tokens/verify");
  const groups = await manager("GET", "/tokens/permission_groups");

  return withTemporaryToken(
    manager,
    {
      name: tokenName(ops.project, "offboarding (temporary)"),
      accountId,
      policies: [
        accountPolicy(accountId, offboardingAccountPermissions, groups),
        zonePolicy(ops.cloudflare.zoneId, offboardingZonePermissions, groups),
      ],
      fetch,
    },
    (cloudflare) =>
      work({
        ops,
        cloudflare: cloudflareOperations({ manager, cloudflare, managerId, project: ops.project }),
        ploi: ploiOperations(ploi, ops.ploi.siteId),
        github: githubOperations(exec, env, ops.github.repository),
        async backupDatabase() {
          const r2 = {
            R2_ACCESS_KEY_ID: await stagingSecret("R2_ACCESS_KEY_ID"),
            R2_SECRET_ACCESS_KEY: await stagingSecret("R2_SECRET_ACCESS_KEY"),
            PLOI_API_TOKEN: await stagingSecret("PLOI_API_TOKEN"),
          };
          const code = await runBackup({
            ...dependencies,
            parsed: {},
            context: { ...context, env: { ...context.env, ...r2 } },
          });
          if (code !== 0) throw new Error("The final database backup failed.");
        },
      }),
  );
}

function cloudflareOperations({ manager, cloudflare, managerId, project }) {
  const prefix = tokenName(project, "");
  return {
    // The project's own tokens ("GETQUICK <PROJECT> …"), without the
    // temporary ones gq mints and deletes, and never the manager token.
    async projectTokens() {
      const tokens = await manager("GET", "/tokens?per_page=50");
      return tokens.filter(
        (token) =>
          token.name.startsWith(prefix) &&
          !token.name.endsWith("(temporary)") &&
          token.id !== managerId,
      );
    },
    // Cloudflare replaces a token on update, so everything but its status
    // is sent back as it was listed.
    setTokenStatus(token, status) {
      const kept = ["name", "policies", "condition", "expires_on", "not_before"];
      const body = Object.fromEntries(
        kept.filter((key) => token[key] !== undefined).map((key) => [key, token[key]]),
      );
      return manager("PUT", `/tokens/${token.id}`, { ...body, status });
    },
    async accountSubdomain() {
      return (await cloudflare("GET", "/workers/subdomain")).subdomain;
    },
    workerDomains: (service) =>
      cloudflare("GET", `/workers/domains?service=${encodeURIComponent(service)}`),
    detachWorkerDomain: (id) => cloudflare("DELETE", `/workers/domains/${id}`),
    attachWorkerDomain: ({ hostname, service, zoneId }) =>
      cloudflare("PUT", "/workers/domains", {
        hostname,
        service,
        zone_id: zoneId,
        environment: "production",
      }),
    workerSubdomain: (script) => cloudflare("GET", `/workers/scripts/${script}/subdomain`),
    // `previewsEnabled` left out keeps Cloudflare's default for it.
    setWorkerSubdomain: (script, { enabled, previewsEnabled }) =>
      cloudflare("POST", `/workers/scripts/${script}/subdomain`, {
        enabled,
        ...(previewsEnabled === undefined ? {} : { previews_enabled: previewsEnabled }),
      }),
    async bucketDomain(bucket, domain) {
      const { domains = [] } = await cloudflare("GET", `/r2/buckets/${bucket}/domains/custom`);
      return domains.find((candidate) => candidate.domain === domain);
    },
    setBucketDomain: (bucket, domain, enabled) =>
      cloudflare("PUT", `/r2/buckets/${bucket}/domains/custom/${domain}`, { enabled }),
  };
}

function ploiOperations(client, siteId) {
  const sitePath = `/sites/${siteId}`;
  return {
    async site() {
      return (await client.request("GET", sitePath)).data ?? {};
    },
    suspend: (reason) => client.request("POST", `${sitePath}/suspend`, { reason }),
    resume: () => client.request("POST", `${sitePath}/resume`),
    async crontabs() {
      return (await client.request("GET", "/crontabs")).data ?? [];
    },
    deleteCrontab: (id) => client.request("DELETE", `/crontabs/${id}`),
    createCrontab: (crontab) => client.request("POST", "/crontabs", crontab),
  };
}

// The repository's webhooks through the operator's `gh` login (it needs repo
// admin, as `gq github setup` does). Bodies go over stdin.
function githubOperations(exec, env, repository) {
  async function gh(args, input) {
    const result = await exec("gh", ["api", ...args], {
      env,
      input: input === undefined ? undefined : JSON.stringify(input),
    });
    if (result.code !== 0) {
      throw new Error(`gh api ${args.join(" ")} failed: ${result.stderr.trim()}`);
    }
    return result.stdout ? JSON.parse(result.stdout) : null;
  }
  return {
    repository,
    hooks: () => gh([`repos/${repository}/hooks`]),
    updateHook: (id, change) =>
      gh(["-X", "PATCH", `repos/${repository}/hooks/${id}`, "--input", "-"], change),
  };
}
