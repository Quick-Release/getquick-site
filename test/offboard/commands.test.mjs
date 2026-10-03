// `gq offboard` (cut a Site's public access) and `gq offboard --restore` at
// the run() seam, against one in-memory account (test/support/offboarding.mjs):
// the plan and its dry run, cutting in order, idempotency, restoring, and the
// gq.ops.json record. The guards the record turns on are in guards.test.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  changes,
  ENV,
  fakeAccount,
  offboardingSite,
  OPS,
  RETRY_CRONTAB,
} from "../support/offboarding.mjs";
import { recordingFetch } from "../support/fixture-site.mjs";

async function readOps(fixture) {
  return JSON.parse(await readFile(fixture.path("gq.ops.json"), "utf8"));
}

test("offboard --dry-run plans every cut in order and changes nothing", async () => {
  const fixture = await offboardingSite();
  const { fetch, exec, state } = fakeAccount();

  const result = await fixture.run(["offboard", "--dry-run"], { env: ENV, fetch, exec });

  assert.equal(result.code, 0, result.stderr);
  const plan = result.stdout.split("\n").filter((line) => /^ {2}[-✓!] /u.test(line));
  assert.deepEqual(plan, [
    "  - Backup: back up fixture_db to r2://fixture-releases/db/ before anything is cut",
    "  - CMS: delete the retry crontab (fixture: wp gq-events retry-due)",
    '  - CMS: suspend the Ploi site fixture-cms.example.test (reason "offboarded"); its files, .env and database stay',
    "  ! CMS: Ploi's API can't disable the site's deploy webhook; the suspension is what stops it",
    "  ! CMS: the DNS record for fixture-cms.example.test was added by hand; remove it by hand if it should go",
    "  - Frontend: detach fixture-fe.example.test from the Worker fixture-fe",
    "  - Frontend: switch the Worker fixture-fe's workers.dev and preview URLs off (the Worker and its D1 store stay)",
    "  - Media: disable https://fixture-media.example.test on the bucket fixture-media (the bucket and its objects stay)",
    "  - CI: deactivate the GitHub push webhook 99 on Example/fixture",
    "  - CI: switch the CI Worker fixture-ci's workers.dev off",
    "  - Tokens: disable GETQUICK FIXTURE Staging Alchemy",
    "  - Tokens: disable GETQUICK FIXTURE Releases R2",
    "  - Tokens: disable GETQUICK FIXTURE Media R2",
    "  - Tokens: disable GETQUICK FIXTURE CI Deploy",
    "  - Record: write offboarded to gq.ops.json (commit it)",
  ]);
  assert.match(result.stdout, /Dry run: nothing changed\./u);
  assert.deepEqual(state.log, []);
  // The only change a dry run makes is its own temporary token, deleted after.
  assert.deepEqual(changes(fetch), [
    "POST /client/v4/accounts/account-1/tokens",
    "DELETE /client/v4/accounts/account-1/tokens/temp-1",
  ]);
  assert.equal((await readOps(fixture)).offboarded, undefined);
  assert.deepEqual(await readOps(fixture), OPS);
});

test("offboard --yes cuts in order, tokens last, and records offboarded", async () => {
  const fixture = await offboardingSite();
  const { fetch, exec, state } = fakeAccount();

  const result = await fixture.run(["offboard", "--yes"], { env: ENV, fetch, exec });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(state.log, [
    "database backed up",
    "crontab 7 deleted",
    "ploi site suspended (offboarded)",
    "worker domain wd-1 detached",
    'workers.dev fixture-fe {"enabled":false,"previews_enabled":false}',
    "media domain fixture-media.example.test disabled",
    "github hook 99 inactive",
    'workers.dev fixture-ci {"enabled":false,"previews_enabled":false}',
    "token t-alchemy disabled",
    "token t-releases disabled",
    "token t-media disabled",
    "token t-deploy disabled",
  ]);
  // The final backup ran on the server as the site's user, into the backups bucket.
  assert.equal(state.scripts[0].user, "fixture");
  assert.match(state.scripts[0].content, /fixture-releases\/db\/fixture_db\//u);

  const { offboarded, ...rest } = await readOps(fixture);
  assert.deepEqual(rest, OPS, "nothing else in gq.ops.json changes");
  assert.equal(offboarded.phase, "cut");
  assert.ok(Math.abs(Date.parse(offboarded.at) - Date.now()) < 60_000, offboarded.at);
  assert.match(result.stdout, /Offboarded fixture\. Commit gq\.ops\.json/u);
});

test("offboard leaves what isn't the Site's alone: other Workers, hooks, crontabs and tokens", async () => {
  const fixture = await offboardingSite();
  const { fetch, exec, state } = fakeAccount();

  const result = await fixture.run(["offboard", "--yes"], { env: ENV, fetch, exec });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    state.workerDomains.map(({ id }) => id),
    ["wd-other"],
  );
  assert.equal(state.hooks.find(({ id }) => id === 100).active, true);
  assert.deepEqual(
    state.crontabs.map(({ id }) => id),
    [8],
  );
  const statuses = Object.fromEntries(state.tokens.map(({ id, status }) => [id, status]));
  assert.equal(statuses.manager, "active", "the manager token is never disabled");
  assert.equal(statuses.other, "active", "another project's token is untouched");
  assert.ok(
    state.tokens.every(({ id }) => !id.startsWith("temp-")),
    "the temporary token is deleted",
  );
});

test("offboard again changes nothing once everything is cut", async () => {
  const fixture = await offboardingSite();
  const account = fakeAccount();
  const first = await fixture.run(["offboard", "--yes"], { env: ENV, ...account });
  assert.equal(first.code, 0, first.stderr);
  const recorded = await readOps(fixture);
  account.state.log.length = 0;
  account.fetch.requests.length = 0;

  const again = await fixture.run(["offboard", "--yes"], { env: ENV, ...account });

  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(account.state.log, []);
  assert.doesNotMatch(again.stdout, /^ {2}- /mu);
  assert.match(again.stdout, /Nothing left to cut: fixture is offboarded\./u);
  assert.deepEqual(await readOps(fixture), recorded, "the record keeps its date");
});

test("offboard after a failed run cuts only what is still exposed, without a new backup", async () => {
  const fixture = await offboardingSite();
  const { fetch, exec, state } = fakeAccount({
    site: {
      id: 34,
      domain: "fixture-cms.example.test",
      status: "suspended",
      system_user: "fixture",
    },
    crontabs: [],
  });

  const result = await fixture.run(["offboard", "--yes"], { env: ENV, fetch, exec });

  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /✓ Backup: the CMS is suspended, so the backup taken before is the final one/u,
  );
  assert.match(result.stdout, /✓ CMS: the Ploi site fixture-cms\.example\.test is suspended/u);
  assert.deepEqual(state.scripts, [], "no backup of a suspended CMS");
  assert.equal(state.log[0], "worker domain wd-1 detached");
  assert.equal(state.log.at(-1), "token t-deploy disabled");
  assert.equal((await readOps(fixture)).offboarded.phase, "cut");
});

test("offboard without a terminal or --yes shows the plan and changes nothing", async () => {
  const fixture = await offboardingSite();
  const { fetch, exec, state } = fakeAccount();

  const result = await fixture.run(["offboard"], { env: ENV, fetch, exec });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /- CMS: suspend the Ploi site/u);
  assert.match(result.stderr, /Not a TTY: re-run with --yes to apply, or --dry-run to inspect\./u);
  assert.deepEqual(state.log, []);
  assert.ok(
    state.tokens.every(({ id }) => !id.startsWith("temp-")),
    "the temporary token is deleted",
  );
});

// --- gq offboard --restore ---------------------------------------------------

test("offboard --restore brings back everything the cut took, in reverse, and removes the record", async () => {
  const fixture = await offboardingSite();
  const account = fakeAccount();
  assert.equal((await fixture.run(["offboard", "--yes"], { env: ENV, ...account })).code, 0);
  account.state.log.length = 0;
  account.fetch.requests.length = 0;

  const result = await fixture.run(["offboard", "--restore", "--yes"], { env: ENV, ...account });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(account.state.log, [
    "token t-alchemy active",
    "token t-releases active",
    "token t-media active",
    "token t-deploy active",
    'workers.dev fixture-ci {"enabled":true}',
    "github hook 99 active",
    "media domain fixture-media.example.test enabled",
    "worker domain fixture-fe.example.test attached to fixture-fe",
    'workers.dev fixture-fe {"enabled":false,"previews_enabled":true}',
    "ploi site resumed",
    `crontab added: ${RETRY_CRONTAB.command}`,
  ]);
  const attached = account.state.workerDomains.find(({ service }) => service === "fixture-fe");
  assert.deepEqual(
    { ...attached, id: undefined },
    {
      id: undefined,
      hostname: "fixture-fe.example.test",
      service: "fixture-fe",
      zone_id: "zone-1",
      environment: "production",
    },
  );
  assert.deepEqual(account.state.crontabs.at(-1), { id: 70, ...RETRY_CRONTAB });
  // Tokens are re-enabled, never created again (planToken would "create" a
  // disabled one): the only token created is the run's temporary one.
  assert.deepEqual(
    changes(account.fetch).filter(
      (change) => change.startsWith("POST") && change.endsWith("/tokens"),
    ),
    ["POST /client/v4/accounts/account-1/tokens"],
  );
  assert.deepEqual(await readOps(fixture), OPS);
  assert.match(result.stdout, /Restored fixture\./u);
});

test("offboard --restore on a live Site has nothing to do", async () => {
  const fixture = await offboardingSite();
  const { fetch, exec, state } = fakeAccount();

  const result = await fixture.run(["offboard", "--restore", "--yes"], { env: ENV, fetch, exec });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(state.log, []);
  assert.match(result.stdout, /Nothing to restore: fixture is not offboarded\./u);
});

test("offboard --restore --dry-run plans the restore and changes nothing", async () => {
  const fixture = await offboardingSite();
  const account = fakeAccount();
  assert.equal((await fixture.run(["offboard", "--yes"], { env: ENV, ...account })).code, 0);
  const recorded = await readOps(fixture);
  account.state.log.length = 0;

  const result = await fixture.run(["offboard", "--restore", "--dry-run"], {
    env: ENV,
    ...account,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^ {2}\+ Tokens: re-enable GETQUICK FIXTURE Staging Alchemy$/mu);
  assert.match(
    result.stdout,
    /^ {2}\+ Frontend: attach fixture-fe\.example\.test to the Worker fixture-fe$/mu,
  );
  assert.match(result.stdout, /^ {2}\+ CMS: resume the Ploi site fixture-cms\.example\.test$/mu);
  assert.match(
    result.stdout,
    /^ {2}\+ Record: remove offboarded from gq\.ops\.json \(commit it\)$/mu,
  );
  assert.deepEqual(account.state.log, []);
  assert.deepEqual(await readOps(fixture), recorded);
});

test("offboard --restore refuses once the Site is archived", async () => {
  const fixture = await offboardingSite({
    ops: { ...OPS, offboarded: { at: "2026-10-01T09:00:00.000Z", phase: "archived" } },
  });
  const { fetch, exec } = fakeAccount();

  const result = await fixture.run(["offboard", "--restore", "--yes"], { env: ENV, fetch, exec });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /fixture was archived .*nothing to restore/u);
  assert.deepEqual(fetch.requests, []);
});

// --- credentials and failures ------------------------------------------------

test("a cut that fails leaves the tokens active and nothing recorded, so a rerun can finish", async () => {
  const fixture = await offboardingSite();
  const account = fakeAccount();
  const failing = recordingFetch((request) => {
    if (
      request.method === "POST" &&
      request.url.endsWith("/workers/scripts/fixture-ci/subdomain")
    ) {
      return new Response(JSON.stringify({ success: false, errors: [{ message: "boom" }] }), {
        status: 500,
      });
    }
    return account.fetch(request.url, request);
  });

  const result = await fixture.run(["offboard", "--yes"], {
    env: ENV,
    fetch: failing,
    exec: account.exec,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /workers\/scripts\/fixture-ci\/subdomain failed: boom/u);
  assert.ok(
    account.state.tokens
      .filter(({ name }) => name.startsWith("GETQUICK FIXTURE "))
      .every(({ status }) => status === "active"),
    "no token is disabled before everything else is cut",
  );
  assert.equal((await readOps(fixture)).offboarded, undefined);
  assert.ok(
    account.state.tokens.every(({ id }) => !id.startsWith("temp-")),
    "the temporary token is deleted",
  );

  const rerun = await fixture.run(["offboard", "--yes"], { env: ENV, ...account });
  assert.equal(rerun.code, 0, rerun.stderr);
  assert.equal((await readOps(fixture)).offboarded.phase, "cut");
});

test("offboard reads Ploi's token and the R2 key from Sigillo staging and prints no secret", async () => {
  const fixture = await offboardingSite();
  const { fetch, exec } = fakeAccount();

  const result = await fixture.run(["offboard", "--yes"], { env: ENV, fetch, exec });

  assert.equal(result.code, 0, result.stderr);
  const reads = exec.calls
    .filter(({ args }) => args[0] === "secrets")
    .map(({ args }) => args.slice(0, 3).join(" "));
  assert.deepEqual([...new Set(reads)].sort(), [
    "secrets get PLOI_API_TOKEN",
    "secrets get R2_ACCESS_KEY_ID",
    "secrets get R2_SECRET_ACCESS_KEY",
  ]);
  const ploi = fetch.requests.filter(({ url }) => url.startsWith("https://ploi.io/"));
  assert.ok(ploi.every(({ headers }) => headers.Authorization === "Bearer ploi-secret"));
  for (const secret of ["manager-secret", "ploi-secret", "r2-secret", "temp-value-1"]) {
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret), secret);
  }
});

test("offboard needs the token-manager token and names the gq.ops.json keys it lacks", async () => {
  const fixture = await offboardingSite();
  const withoutManager = await fixture.run(["offboard", "--dry-run"], { env: {} });
  assert.equal(withoutManager.code, 1);
  assert.match(withoutManager.stderr, /CLOUDFLARE_TOKEN_MANAGER_API_TOKEN is missing/u);

  const { media, github, ...ops } = OPS;
  void media;
  void github;
  const partial = await offboardingSite({ ops });
  const result = await partial.run(["offboard", "--dry-run"], { env: ENV });
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /gq\.ops\.json media\.bucket, media\.domain, github\.repository are required to offboard\./u,
  );
});
