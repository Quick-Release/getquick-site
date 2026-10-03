// An exposed Site for the offboarding commands at the run() seam: a fixture
// site with every block `gq offboard` reads, and one in-memory account behind
// a recording fetch (Cloudflare and Ploi) and a recording exec (Sigillo and
// gh). `state` holds what each provider would report, and `state.log` every
// change in the order it was made, so a test can tell what was cut, restored
// or deleted, and when. Nothing here reaches the network or a real account.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createFixtureSite, recordingExec, recordingFetch } from "./fixture-site.mjs";

export const OPS = Object.freeze({
  schemaVersion: 1,
  project: "fixture",
  variant: "content",
  sigillo: {
    apiUrl: "https://secrets.example.test",
    projectId: "PROJECT123",
    environments: { operations: "ops", staging: "stage" },
  },
  domains: { admin: "fixture-cms.example.test", frontend: "fixture-fe.example.test" },
  ploi: { serverId: "12", siteId: "34", systemUser: "fixture", database: "fixture_db" },
  releases: { bucket: "fixture-releases", prefix: "admin/" },
  backups: { bucket: "fixture-releases", prefix: "db/" },
  media: { bucket: "fixture-media", domain: "fixture-media.example.test" },
  artifacts: { namespace: "fixture", repo: "fixture" },
  ci: { worker: "fixture-ci", backupBucket: "fixture-ci-backups" },
  cloudflare: { accountId: "account-1", zoneId: "zone-1", zoneName: "example.test" },
  github: { repository: "Example/fixture" },
});

// What `gq sigillo run operations` injects: only the token-manager token.
export const ENV = Object.freeze({ CLOUDFLARE_TOKEN_MANAGER_API_TOKEN: "manager-secret" });

// What Sigillo staging holds for the Ploi and R2 calls.
export const STAGING = Object.freeze({
  PLOI_API_TOKEN: "ploi-secret",
  R2_ACCESS_KEY_ID: "r2-key",
  R2_SECRET_ACCESS_KEY: "r2-secret",
});

const SIGILLO_BIN = "node_modules/.bin/sigillo";
export const WEBHOOK_URL = "https://fixture-ci.fixture-sub.workers.dev/github/webhook";
export const RETRY_CRONTAB = Object.freeze({
  user: "fixture",
  frequency: "* * * * *",
  command:
    'cd /home/fixture/fixture-cms.example.test/apps/cms && PATH="/usr/local/bin:$PATH" wp gq-events retry-due --quiet',
});

export function offboardingSite({ ops = OPS } = {}) {
  return createFixtureSite({
    ops,
    files: {
      "package.json": `${JSON.stringify({ devDependencies: { sigillo: "0.13.0" } })}\n`,
      [SIGILLO_BIN]: "#!/bin/sh\n",
    },
  });
}

const PERMISSION_GROUPS = [
  "Workers Scripts Read",
  "Workers Scripts Write",
  "Workers Routes Write",
  "Workers R2 Storage Write",
  "Zone Read",
  "DNS Write",
].map((name, index) => ({ id: `group-${index}`, name }));

const projectToken = (id, purpose) => ({
  id,
  name: `GETQUICK FIXTURE ${purpose}`,
  status: "active",
  policies: [{ effect: "allow", resources: {}, permission_groups: [{ id: "g", name: "Some" }] }],
});

// A Site with everything still exposed, unless `overrides` says otherwise.
export function exposedState() {
  return {
    tokens: [
      { id: "manager", name: "GETQUICK token manager", status: "active", policies: [] },
      projectToken("t-alchemy", "Staging Alchemy"),
      projectToken("t-releases", "Releases R2"),
      projectToken("t-media", "Media R2"),
      projectToken("t-deploy", "CI Deploy"),
      { id: "other", name: "GETQUICK OTHER Staging Alchemy", status: "active", policies: [] },
    ],
    workerDomains: [
      {
        id: "wd-1",
        hostname: "fixture-fe.example.test",
        service: "fixture-fe",
        zone_id: "zone-1",
        environment: "production",
      },
      {
        id: "wd-other",
        hostname: "other-fe.example.test",
        service: "other-fe",
        zone_id: "zone-1",
        environment: "production",
      },
    ],
    subdomains: {
      "fixture-fe": { enabled: false, previews_enabled: true },
      "fixture-ci": { enabled: true, previews_enabled: false },
    },
    bucketDomains: {
      "fixture-media": [{ domain: "fixture-media.example.test", enabled: true }],
    },
    site: {
      id: 34,
      domain: "fixture-cms.example.test",
      status: "active",
      system_user: "fixture",
    },
    crontabs: [
      { id: 7, ...RETRY_CRONTAB },
      { id: 8, user: "fixture", frequency: "0 3 * * *", command: "other job" },
    ],
    hooks: [
      { id: 99, active: true, config: { url: WEBHOOK_URL } },
      { id: 100, active: true, config: { url: "https://elsewhere.example.test/hook" } },
    ],
    scripts: [],
    staging: { ...STAGING },
    log: [],
  };
}

const DUMP_SHA = createHash("sha256").update("dump").digest("hex");

// `state` is exposedState() with `overrides` applied. Every Cloudflare call
// under the account checks its bearer token: tokens are managed with the
// manager token, everything else with the run's temporary token.
export function fakeAccount(overrides = {}) {
  const state = { ...exposedState(), ...overrides };
  let next = 1;
  const temporary = new Map();

  const fetch = recordingFetch(({ method, url, body, headers }) => {
    const { hostname, pathname, search } = new URL(url);
    const data = body === undefined ? undefined : JSON.parse(body);

    if (hostname === "ploi.io") return ploi(method, pathname.replace("/api/servers/12", ""), data);

    const prefix = "/client/v4/accounts/account-1";
    assert.ok(pathname.startsWith(prefix), `outside the account: ${url}`);
    const path = `${pathname.slice(prefix.length)}${search}`;
    const bearer = headers.Authorization.replace("Bearer ", "");
    const ok = (result) => ({ success: true, result });

    if (path.startsWith("/tokens")) {
      assert.equal(bearer, "manager-secret", `${method} ${path} uses the manager token`);
      if (method === "GET" && path === "/tokens?per_page=50") return ok(state.tokens);
      if (method === "GET" && path === "/tokens/verify") return ok({ id: "manager" });
      if (method === "GET" && path === "/tokens/permission_groups") return ok(PERMISSION_GROUPS);
      if (method === "POST" && path === "/tokens") {
        const token = {
          id: `temp-${next}`,
          value: `temp-value-${next}`,
          status: "active",
          ...data,
        };
        next += 1;
        temporary.set(token.value, token);
        state.tokens.push(token);
        return ok(token);
      }
      const id = /^\/tokens\/([^/]+)$/u.exec(path)?.[1];
      const token = state.tokens.find((candidate) => candidate.id === id);
      if (method === "PUT" && token) {
        assert.equal(data.name, token.name, "an update keeps the token's name");
        assert.deepEqual(data.policies, token.policies, "an update keeps its policies");
        token.status = data.status;
        state.log.push(`token ${id} ${data.status}`);
        return ok(token);
      }
      if (method === "DELETE" && token) {
        state.tokens = state.tokens.filter((candidate) => candidate.id !== id);
        if (!temporary.has(token.value)) state.log.push(`token ${id} deleted`);
        return ok({});
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    }

    assert.ok(temporary.has(bearer), `${method} ${path} uses the temporary token`);
    if (method === "GET" && path === "/workers/subdomain") return ok({ subdomain: "fixture-sub" });
    const service = /^\/workers\/domains\?service=(.+)$/u.exec(path)?.[1];
    if (method === "GET" && service) {
      return ok(state.workerDomains.filter((domain) => domain.service === service));
    }
    const domainId = /^\/workers\/domains\/(.+)$/u.exec(path)?.[1];
    if (method === "DELETE" && domainId) {
      state.workerDomains = state.workerDomains.filter((domain) => domain.id !== domainId);
      state.log.push(`worker domain ${domainId} detached`);
      return ok(null);
    }
    if (method === "PUT" && path === "/workers/domains") {
      const domain = { id: `wd-${next}`, ...data };
      next += 1;
      state.workerDomains.push(domain);
      state.log.push(`worker domain ${data.hostname} attached to ${data.service}`);
      return ok(domain);
    }
    const script = /^\/workers\/scripts\/([^/]+)\/subdomain$/u.exec(path)?.[1];
    if (script && state.subdomains[script]) {
      if (method === "GET") return ok(state.subdomains[script]);
      if (method === "POST") {
        state.subdomains[script] = { ...state.subdomains[script], ...data };
        state.log.push(`workers.dev ${script} ${JSON.stringify(data)}`);
        return ok(state.subdomains[script]);
      }
    }
    const custom = /^\/r2\/buckets\/([^/]+)\/domains\/custom(?:\/(.+))?$/u.exec(path);
    if (custom) {
      const list = state.bucketDomains[custom[1]] ?? [];
      if (method === "GET") return ok({ domains: list });
      const domain = list.find((entry) => entry.domain === custom[2]);
      if (method === "PUT" && domain) {
        domain.enabled = data.enabled;
        state.log.push(`media domain ${custom[2]} ${data.enabled ? "enabled" : "disabled"}`);
        return ok(domain);
      }
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });

  function ploi(method, path, data) {
    const route = `${method} ${path}`;
    if (route === "GET /sites/34") return { data: state.site };
    if (route === "POST /sites/34/suspend") {
      state.site = { ...state.site, status: "suspended" };
      state.log.push(`ploi site suspended (${data.reason})`);
      return { data: state.site };
    }
    if (route === "POST /sites/34/resume") {
      state.site = { ...state.site, status: "active" };
      state.log.push("ploi site resumed");
      return { data: state.site };
    }
    if (route === "GET /crontabs") return { data: state.crontabs };
    const crontab = /^DELETE \/crontabs\/(\d+)$/u.exec(route)?.[1];
    if (crontab) {
      state.crontabs = state.crontabs.filter((entry) => String(entry.id) !== crontab);
      state.log.push(`crontab ${crontab} deleted`);
      return {};
    }
    if (route === "POST /crontabs") {
      state.crontabs = [...state.crontabs, { id: 70, ...data }];
      state.log.push(`crontab added: ${data.command}`);
      return { data: state.crontabs.at(-1) };
    }
    if (route === "POST /scripts/run") {
      state.scripts.push(data);
      state.log.push("database backed up");
      return { data: { id: 9 } };
    }
    if (route === "GET /scripts/run/9") {
      return {
        data: {
          status: "finished",
          exit_code: 0,
          output: `FIXTURE_DB_EXPORT=success PREFIX=wp_ WORDPRESS=7.1.2 BYTES=4 SHA256=${DUMP_SHA}\n`,
        },
      };
    }
    throw new Error(`Unexpected request: ${route}`);
  }

  // Sigillo staging (read with `secrets get --raw`) and gh's REST calls.
  const exec = recordingExec(({ command, args, input }) => {
    if (command === "gh") return gh(args, input);
    assert.ok(command.endsWith(SIGILLO_BIN), `unexpected child: ${command}`);
    const environment = args[args.indexOf("--env") + 1];
    assert.equal(environment, "stage", "only staging is read through Sigillo");
    if (args[0] === "secrets" && args[1] === "get") {
      const value = state.staging[args[2]];
      return value === undefined
        ? { code: 1, stderr: `secret ${args[2]} not found` }
        : { stdout: `${value}\n` };
    }
    return { code: 1, stderr: `unexpected sigillo ${args.join(" ")}` };
  });

  function gh(args, input) {
    assert.equal(args[0], "api");
    const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
    const path = args.find((argument) => argument.startsWith("repos/"));
    if (method === "GET" && path === "repos/Example/fixture/hooks") {
      return { stdout: JSON.stringify(state.hooks) };
    }
    const id = /^repos\/Example\/fixture\/hooks\/(\d+)$/u.exec(path)?.[1];
    const hook = state.hooks.find((candidate) => String(candidate.id) === id);
    if (method === "PATCH" && hook) {
      const change = JSON.parse(input);
      Object.assign(hook, change);
      state.log.push(`github hook ${id} ${change.active ? "active" : "inactive"}`);
      return { stdout: JSON.stringify(hook) };
    }
    return { code: 1, stderr: `unexpected gh ${args.join(" ")}` };
  }

  return { fetch, exec, state };
}

// Every request that changed something, as "METHOD path".
export function changes(fetch) {
  return fetch.requests
    .filter(({ method }) => method !== "GET")
    .map(({ method, url }) => `${method} ${new URL(url).pathname}`);
}
