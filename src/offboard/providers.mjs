// The provider operations offboarding plans and applies against: Cloudflare
// (the project's tokens, Workers, Workflows, containers, D1, custom domains,
// R2, Artifacts and the zone's DNS records), the Ploi site, its crontab,
// database and system user, the GitHub repository and its webhooks, and the
// CMS database backup and dump.
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
//
// R2 objects (the archive's reads, writes and emptied buckets) go through
// keys scoped to one bucket each, minted for the run as 1-hour tokens
// ("GETQUICK <PROJECT> offboarding <bucket> (temporary)") and deleted with
// the run's token: phase 1 disabled the project's own bucket keys, and a
// scoped key can't reach another client's bucket.

import { setTimeout as sleep } from "node:timers/promises";

import { redactText } from "../cli/redact.mjs";

import { exportLiveDatabase, runBackup } from "../db/sync.mjs";
import { createR2Client, s3CredentialsFromToken } from "../r2.mjs";
import { createPloiServerClient } from "../ploi/server-client.mjs";
import { sigilloSecrets } from "../sigillo/commands.mjs";
import { createCloudflareAccountClient } from "../cloudflare/account-client.mjs";
import {
  accountPolicy,
  bucketPolicies,
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
// The archive also deletes: Workers (and their Workflows), container
// applications, D1 stores (after exporting one), buckets, and Artifacts
// repositories; and deletes DNS records with the zone permissions above.
export const archiveAccountPermissions = [
  ...offboardingAccountPermissions,
  "D1 Read",
  "D1 Write",
  "Workers Containers Read",
  "Workers Containers Write",
  "Artifacts Read",
  "Artifacts Write",
];

// A deletion finds what it deletes already gone (another deletion took it
// along, or a rerun): that is done, not a failure.
const GONE = { allowNotFound: true };
const ONE_HOUR = 60 * 60 * 1000;
const D1_EXPORT_POLL_MS = 2000;
const D1_EXPORT_TIMEOUT_MS = 15 * 60 * 1000;

// The gq.ops.json keys offboarding reads, checked before anything runs. The
// archive forgets ploi.siteId once it deletes the site, so it doesn't need it.
const SITE_ID_KEY = ["ploi.siteId", (ops) => ops.ploi?.siteId];
const REQUIRED_KEYS = [
  ["domains.admin", (ops) => ops.domains?.admin],
  ["domains.frontend", (ops) => ops.domains?.frontend],
  ["ploi.serverId", (ops) => ops.ploi?.serverId],
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
const ARCHIVE_KEYS = [
  ["releases.bucket", (ops) => ops.releases?.bucket],
  ["ci.backupBucket", (ops) => ops.ci?.backupBucket],
  ["artifacts.namespace", (ops) => ops.artifacts?.namespace],
  ["artifacts.repo", (ops) => ops.artifacts?.repo],
];

// Runs `work(providers)` with every provider connected, and deletes the
// temporary Cloudflare tokens afterwards whatever happens. `dependencies` are
// the run() seam's (context, env, fetch, exec, io, interactive); `archive`
// grants what the archive needs and requires its keys.
export async function withOffboardingProviders(dependencies, work, { archive = false } = {}) {
  const { context, env, fetch, exec } = dependencies;
  const ops = context.config;
  const required = archive ? [...REQUIRED_KEYS, ...ARCHIVE_KEYS] : [...REQUIRED_KEYS, SITE_ID_KEY];
  const missing = required.filter(([, read]) => !read(ops)).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `gq.ops.json ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required to ${archive ? "archive" : "offboard"}.`,
    );
  }
  const accountId = ops.cloudflare.accountId;
  const manager = createCloudflareAccountClient({
    token: managerToken(context, "offboard"),
    accountId,
    fetch,
  });
  const staging = await sigilloSecrets({ context, env, exec }, SECRETS_ENVIRONMENT);
  // A secret Sigillo doesn't list (or holds empty) is missing; one it lists
  // but can't hand over, or a listing that fails too, is a failed read.
  const stagingSecret = async (name) => {
    const injected = context.env[name]?.trim();
    if (injected) return injected;
    const missing = new Error(`${name} is missing in Sigillo ${staging.name}.`);
    let value;
    try {
      value = await staging.get(name);
    } catch (error) {
      const listed = await staging.list().catch(() => undefined);
      if (listed !== undefined && !new RegExp(`\\b${name}\\b`, "u").test(listed)) throw missing;
      throw new Error(
        `Reading ${name} from Sigillo ${staging.name} failed: ${redactText(error.message)}`,
        {
          cause: error,
        },
      );
    }
    if (!value) throw missing;
    return value;
  };

  const ploiClient = createPloiServerClient({
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
      zoneId: ops.cloudflare.zoneId,
      policies: [
        accountPolicy(
          accountId,
          archive ? archiveAccountPermissions : offboardingAccountPermissions,
          groups,
        ),
        zonePolicy(ops.cloudflare.zoneId, offboardingZonePermissions, groups),
      ],
      fetch,
    },
    async (cloudflare, zone) => {
      const keys = scopedKeys({ manager, accountId, project: ops.project, groups, fetch });
      let failure;
      try {
        return await work({
          ops,
          cloudflare: cloudflareOperations({
            manager,
            cloudflare,
            zone,
            managerId,
            project: ops.project,
            fetch,
          }),
          ploi: ploiOperations(ploiClient, ops.ploi.siteId),
          github: githubOperations(exec, env, ops.github.repository),
          r2: keys.r2,
          dumpDatabase: (uploadUrl) => exportLiveDatabase(ploiClient, ops, uploadUrl),
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
        });
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        // A key left behind expires within the hour; why the run stopped
        // matters more.
        await keys.close().catch((error) => {
          if (!failure) throw error;
        });
      }
    },
  );
}

// R2 clients for one bucket each, minted on first use as 1-hour tokens that
// can only read and write that bucket's objects; close() deletes them.
function scopedKeys({ manager, accountId, project, groups, fetch }) {
  const minted = new Map();
  async function mint(bucket) {
    const token = await manager("POST", "/tokens", {
      name: tokenName(project, `offboarding ${bucket} (temporary)`),
      expires_on: new Date(Date.now() + ONE_HOUR).toISOString().replace(/\.\d{3}Z$/u, "Z"),
      policies: bucketPolicies({ accountId, bucket }, groups),
    });
    const credentials = await s3CredentialsFromToken(token.id, token.value);
    return { token, client: createR2Client({ accountId, bucket, ...credentials, fetch }) };
  }
  return {
    async r2(bucket) {
      if (!minted.has(bucket)) minted.set(bucket, mint(bucket));
      return (await minted.get(bucket)).client;
    },
    // Deletes every key, then fails on the first that couldn't be.
    async close() {
      const settled = await Promise.allSettled(minted.values());
      const deleted = await Promise.allSettled(
        settled
          .filter((result) => result.status === "fulfilled")
          .map((result) => manager("DELETE", `/tokens/${result.value.token.id}`)),
      );
      const failed = deleted.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
}

function cloudflareOperations({ manager, cloudflare, zone, managerId, project, fetch }) {
  const prefix = tokenName(project, "");
  return {
    // The project's own tokens ("GETQUICK <PROJECT> …"), without the
    // temporary ones gq mints and deletes, and never the manager token.
    async projectTokens() {
      const tokens = await manager("GET", "/tokens", undefined, { paginate: true });
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
    removeBucketDomain: (bucket, domain) =>
      cloudflare("DELETE", `/r2/buckets/${bucket}/domains/custom/${domain}`, undefined, GONE),
    deleteToken: (token) => manager("DELETE", `/tokens/${token.id}`),

    // What the archive reads, exports and deletes.
    async workers() {
      return (await cloudflare("GET", "/workers/scripts")).map((script) => script.id);
    },
    deleteWorker: (name) => cloudflare("DELETE", `/workers/scripts/${name}`, undefined, GONE),
    async workflows() {
      const workflows = await cloudflare("GET", "/workflows", undefined, { paginate: true });
      return workflows.map(({ name }) => name);
    },
    deleteWorkflow: (name) => cloudflare("DELETE", `/workflows/${name}`, undefined, GONE),
    containerApplications: () => cloudflare("GET", "/containers/applications"),
    deleteContainerApplication: (id) =>
      cloudflare("DELETE", `/containers/applications/${id}`, undefined, GONE),
    async d1(name) {
      const found = await cloudflare("GET", `/d1/database?name=${encodeURIComponent(name)}`);
      return found.find((database) => database.name === name);
    },
    // Every D1 store whose name starts with `prefix`.
    async d1Stores(prefix) {
      const query = `?name=${encodeURIComponent(prefix)}`;
      const found = await cloudflare("GET", `/d1/database${query}`, undefined, { paginate: true });
      return found.filter((database) => database.name.startsWith(prefix));
    },
    deleteD1: (id) => cloudflare("DELETE", `/d1/database/${id}`, undefined, GONE),
    // The D1 store's SQL export, as a Response to stream: Cloudflare writes
    // it, then hands out a signed URL for it.
    async exportD1(id) {
      const deadline = Date.now() + D1_EXPORT_TIMEOUT_MS;
      let bookmark;
      while (Date.now() < deadline) {
        const exported = await cloudflare("POST", `/d1/database/${id}/export`, {
          output_format: "polling",
          ...(bookmark ? { current_bookmark: bookmark } : {}),
        });
        if (exported.status === "error") {
          throw new Error(`The D1 export failed: ${exported.error ?? "no reason given"}`);
        }
        const url = exported.result?.signed_url;
        if (exported.status === "complete" && url) {
          const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
          if (!response.ok)
            throw new Error(`Downloading the D1 export failed with ${response.status}`);
          return response;
        }
        bookmark = exported.at_bookmark;
        await sleep(D1_EXPORT_POLL_MS);
      }
      throw new Error("The D1 export did not finish within 15 minutes.");
    },
    async bucketExists(name) {
      const { buckets = [] } = await cloudflare(
        "GET",
        `/r2/buckets?name_contains=${encodeURIComponent(name)}`,
      );
      return buckets.some((bucket) => bucket.name === name);
    },
    createBucket: (name) => cloudflare("POST", "/r2/buckets", { name }),
    deleteBucket: (name) => cloudflare("DELETE", `/r2/buckets/${name}`, undefined, GONE),
    artifactsRepository: (namespace, repo) =>
      cloudflare("GET", `/artifacts/namespaces/${namespace}/repos/${repo}`, undefined, {
        allowNotFound: true,
      }),
    deleteArtifactsRepository: (namespace, repo) =>
      cloudflare("DELETE", `/artifacts/namespaces/${namespace}/repos/${repo}`, undefined, GONE),
    // The zone's own name (its apex).
    async zoneName() {
      return (await zone("GET", "")).name;
    },
    // The zone's records named exactly `hostname`.
    async dnsRecords(hostname) {
      const records = await zone("GET", `/dns_records?name=${encodeURIComponent(hostname)}`);
      return records.filter((record) => record.name.toLowerCase() === hostname.toLowerCase());
    },
    deleteDnsRecord: (id) => zone("DELETE", `/dns_records/${id}`, undefined, GONE),
  };
}

function ploiOperations(client, siteId) {
  const sitePath = `/sites/${siteId}`;
  return {
    async site() {
      return (await client.request("GET", sitePath)).data ?? {};
    },
    // The site, or null once it is deleted (or gq.ops.json forgot it).
    async existingSite() {
      if (!siteId) return null;
      return (
        (await client.request("GET", sitePath, undefined, { allowNotFound: true }))?.data ?? null
      );
    },
    deleteSite: () => client.request("DELETE", sitePath, undefined, GONE),
    // Every site on the server.
    sites: () => client.list("/sites"),
    databases: () => client.list("/databases"),
    deleteDatabase: (id) => client.request("DELETE", `/databases/${id}`, undefined, GONE),
    systemUsers: () => client.list("/system-users"),
    deleteSystemUser: (id) => client.request("DELETE", `/system-users/${id}`, undefined, GONE),
    suspend: (reason) => client.request("POST", `${sitePath}/suspend`, { reason }),
    resume: () => client.request("POST", `${sitePath}/resume`),
    crontabs: () => client.list("/crontabs"),
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
      throw new Error(`gh api ${args.join(" ")} failed: ${redactText(result.stderr.trim())}`);
    }
    return result.stdout ? JSON.parse(result.stdout) : null;
  }
  return {
    repository,
    // Every page of them: --slurp wraps the pages in one array.
    async hooks() {
      return (await gh(["--paginate", "--slurp", `repos/${repository}/hooks?per_page=100`])).flat();
    },
    updateHook: (id, change) =>
      gh(["-X", "PATCH", `repos/${repository}/hooks/${id}`, "--input", "-"], change),
    deleteHook: (id) => gh(["-X", "DELETE", `repos/${repository}/hooks/${id}`]),
    async archived() {
      return (await gh([`repos/${repository}`])).archived === true;
    },
    async headCommit() {
      return (await gh([`repos/${repository}/commits/HEAD`])).sha;
    },
    // Read-only from then on: its code, issues and history stay readable.
    async archive() {
      const result = await exec("gh", ["repo", "archive", repository, "--yes"], { env });
      if (result.code !== 0) {
        throw new Error(
          `gh repo archive ${repository} failed: ${redactText(result.stderr.trim())}`,
        );
      }
    },
  };
}
