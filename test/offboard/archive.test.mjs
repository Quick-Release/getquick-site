// `gq offboard --archive` (phase 2: archive a cut Site's content, then delete
// its infrastructure) at the run() seam, against one in-memory account
// (test/support/offboarding.mjs) that phase 1 has already cut: the plan and
// its dry run, the archive and its verification, the deletions in order, the
// shared zone, resuming after a failure, and the gq.ops.json record.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { recordingFetch } from "../support/fixture-site.mjs";
import {
  answering,
  changes,
  DUMP,
  ENV,
  fakeAccount,
  HEAD_COMMIT,
  offboardingSite,
  OPS,
  PUBLICATIONS_SQL,
  readZip,
  sha256,
} from "../support/offboarding.mjs";

async function readOps(fixture) {
  return JSON.parse(await readFile(fixture.path("gq.ops.json"), "utf8"));
}

const today = () => new Date().toISOString().slice(0, 10);

// A Site phase 1 has cut, and the account it was cut in.
async function cutSite() {
  const fixture = await offboardingSite();
  const account = fakeAccount();
  const cut = await fixture.run(["offboard", "--yes"], { env: ENV, ...account });
  assert.equal(cut.code, 0, cut.stderr);
  account.state.log.length = 0;
  account.fetch.requests.length = 0;
  account.exec.calls.length = 0;
  return { fixture, account };
}

const planLines = (stdout) => stdout.split("\n").filter((line) => /^ {2}[-✓!] /u.test(line));

test("offboard --archive refuses a Site whose access isn't cut", async () => {
  const fixture = await offboardingSite();
  const { fetch, exec, state } = fakeAccount();

  const result = await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, fetch, exec });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /fixture isn't offboarded: run gq offboard first \(pnpm offboard\), which cuts its access and records it\./u,
  );
  assert.deepEqual(fetch.requests, []);
  assert.deepEqual(state.log, []);
});

test("offboard --archive --dry-run plans the archive and every deletion, and changes nothing", async () => {
  const { fixture, account } = await cutSite();
  const before = await readOps(fixture);

  const result = await fixture.run(["offboard", "--archive", "--dry-run"], {
    env: ENV,
    ...account,
  });

  assert.equal(result.code, 0, result.stderr);
  const prefix = `r2://offboarded-clients/fixture/${today()}/`;
  assert.deepEqual(planLines(result.stdout), [
    "  - Archive: create the private bucket offboarded-clients (no custom domain)",
    `  - Archive: ${prefix}uploads.zip ← the 3 objects of fixture-media, keys kept`,
    `  - Archive: ${prefix}database.sql.gz ← a fresh dump of fixture_db`,
    `  - Archive: ${prefix}publications.sql ← the D1 store fixture-fe-publications`,
    `  - Archive: ${prefix}backups/ ← the 2 database backups in r2://fixture-releases/db/`,
    `  - Archive: ${prefix}gq.ops.json, and manifest.json (each file's size and sha256, and the source resources)`,
    "  - Verify: re-read every archived file against manifest.json, and count uploads.zip's entries against fixture-media; nothing is deleted unless all match, then gq.ops.json records the archive",
    "  - Ploi: delete the site fixture-cms.example.test (34) and forget ploi.siteId in gq.ops.json",
    "  - Ploi: delete the database fixture_db (56)",
    "  - Ploi: delete the system user fixture (78)",
    "  - Frontend: delete the Worker fixture-fe",
    "  - Frontend: delete the D1 store fixture-fe-publications (d1-fixture)",
    "  - CI: delete the Worker fixture-ci",
    "  - CI: delete the Workflow fixture-ci",
    "  - CI: delete the Workflow fixture-mirror",
    "  - CI: delete the container application fixture-ci-cisandbox (c-fixture)",
    "  - Media: remove the custom domain fixture-media.example.test from fixture-media",
    "  - R2: empty fixture-media (with a key scoped to it) and delete it",
    "  - R2: empty fixture-releases (with a key scoped to it) and delete it",
    "  - R2: empty fixture-ci-backups (with a key scoped to it) and delete it",
    "  - Artifacts: delete the repository fixture/fixture",
    "  ! Artifacts: the empty namespace fixture stays; delete it in the dashboard if it should go",
    "  - DNS: delete A fixture-cms.example.test → 203.0.113.10",
    "  - DNS: delete AAAA fixture-fe.example.test → 100::",
    "  - DNS: delete CNAME fixture-media.example.test → public.r2.dev",
    "  ✓ DNS: the zone example.test and every other record in it stay",
    "  - Tokens: delete GETQUICK FIXTURE Staging Alchemy",
    "  - Tokens: delete GETQUICK FIXTURE Releases R2",
    "  - Tokens: delete GETQUICK FIXTURE Media R2",
    "  - Tokens: delete GETQUICK FIXTURE CI Deploy",
    "  - GitHub: delete the push webhook 99 on Example/fixture",
    "  - GitHub: archive the repository Example/fixture (it stays readable)",
    '  - Record: offboarded.phase becomes "archived" in gq.ops.json (commit it)',
    "  ! Sigillo: the project PROJECT123 is kept, with the Site's secrets",
  ]);
  assert.match(result.stdout, /Dry run: nothing changed\./u);
  assert.deepEqual(account.state.log, []);
  assert.deepEqual(await readOps(fixture), before);
  assert.ok(
    account.state.tokens.every(({ id }) => !id.startsWith("temp-")),
    "every temporary token is deleted",
  );
});

// The deletions, in gq-smoke-down's order, with the project's tokens last on
// Cloudflare and GitHub after them.
const DELETIONS = [
  "ploi site deleted",
  "ploi database 56 deleted",
  "ploi system user 78 deleted",
  "worker fixture-fe deleted",
  "d1 d1-fixture deleted",
  "worker fixture-ci deleted",
  "workflow fixture-ci deleted",
  "workflow fixture-mirror deleted",
  "container application c-fixture deleted",
  "media domain fixture-media.example.test removed",
  "object fixture-media/2026/01/a.jpg deleted",
  "object fixture-media/2026/02/b c.png deleted",
  "object fixture-media/uploads/ünïcode.txt deleted",
  "bucket fixture-media deleted",
  "object fixture-releases/admin/release-1.tar.gz deleted",
  "object fixture-releases/db/fixture_db/2026-09-30T10-00-00Z.sql.gz deleted",
  // The final backup phase 1 took.
  /^object fixture-releases\/db\/fixture_db\/\d{4}-\d\d-\d\dT[\d-]+Z\.sql\.gz deleted$/u,
  "bucket fixture-releases deleted",
  "object fixture-ci-backups/snapshots/1.tar deleted",
  "bucket fixture-ci-backups deleted",
  "artifacts repo fixture/fixture deleted",
  "dns record r-cms deleted",
  "dns record r-fe deleted",
  "dns record r-media deleted",
  "token t-alchemy deleted",
  "token t-releases deleted",
  "token t-media deleted",
  "token t-deploy deleted",
  "github hook 99 deleted",
  "github repo archived",
];

// `expected` lists object deletions by key: a bucket's objects are deleted
// several at a time, so each run of them is compared sorted.
function assertLog(log, expected) {
  assert.equal(log.length, expected.length, log.join("\n"));
  const sorted = [];
  for (const entry of log) {
    const run = sorted.at(-1);
    if (entry.startsWith("object ") && Array.isArray(run)) run.push(entry);
    else sorted.push(entry.startsWith("object ") ? [entry] : entry);
  }
  const actual = sorted.flatMap((entry) => (Array.isArray(entry) ? entry.sort() : [entry]));
  expected.forEach((entry, index) =>
    entry instanceof RegExp
      ? assert.match(actual[index], entry)
      : assert.equal(actual[index], entry),
  );
}

test("offboard --archive --yes archives everything, verifies it, then deletes in order and records it", async () => {
  const { fixture, account } = await cutSite();
  const { state } = account;
  const media = structuredClone(state.buckets["fixture-media"]);
  const backups = Object.entries(state.buckets["fixture-releases"]).filter(([key]) =>
    key.startsWith("db/"),
  );
  const opsBefore = await readFile(fixture.path("gq.ops.json"));

  const result = await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, ...account });

  assert.equal(result.code, 0, result.stderr);
  assertLog(state.log, ["bucket offboarded-clients created", "database backed up", ...DELETIONS]);

  // The archive: every file under <project>/<UTC date>/, as manifest.json lists it.
  const prefix = `fixture/${today()}/`;
  const archived = state.buckets["offboarded-clients"];
  assert.deepEqual(
    Object.keys(archived).sort(),
    [
      `${prefix}backups/fixture_db/2026-09-30T10-00-00Z.sql.gz`,
      `${prefix}backups/${backups[1][0].slice("db/".length)}`,
      `${prefix}database.sql.gz`,
      `${prefix}gq.ops.json`,
      `${prefix}manifest.json`,
      `${prefix}publications.sql`,
      `${prefix}uploads.zip`,
    ].sort(),
  );
  const zip = readZip(archived[`${prefix}uploads.zip`].body);
  assert.deepEqual(
    zip.map(({ name, body }) => [name, body.toString()]),
    Object.entries(media).map(([key, { body }]) => [key, Buffer.from(body).toString()]),
    "every media object, keys kept",
  );
  assert.equal(archived[`${prefix}database.sql.gz`].body.toString(), DUMP);
  assert.equal(archived[`${prefix}publications.sql`].body.toString(), PUBLICATIONS_SQL);
  assert.deepEqual(archived[`${prefix}gq.ops.json`].body, opsBefore);
  for (const [key, { body }] of backups) {
    assert.deepEqual(archived[`${prefix}backups/${key.slice("db/".length)}`].body, body);
  }

  const manifestBody = archived[`${prefix}manifest.json`].body;
  const manifest = JSON.parse(manifestBody);
  assert.equal(manifest.project, "fixture");
  assert.equal(manifest.prefix, prefix);
  assert.match(manifest.gq, /^\d+\.\d+\.\d+/u);
  assert.ok(Math.abs(Date.parse(manifest.archivedAt) - Date.now()) < 60_000);
  for (const file of manifest.files) {
    const stored = archived[`${prefix}${file.path}`].body;
    assert.equal(file.size, stored.length, file.path);
    assert.equal(file.sha256, sha256(stored), file.path);
  }
  assert.equal(manifest.files.find(({ path }) => path === "uploads.zip").entries, 3);
  assert.deepEqual(manifest.sources, {
    media: { bucket: "fixture-media", domain: "fixture-media.example.test" },
    backups: { bucket: "fixture-releases", prefix: "db/" },
    releases: { bucket: "fixture-releases" },
    ciBackups: { bucket: "fixture-ci-backups" },
    ploi: {
      serverId: "12",
      siteId: "34",
      domain: "fixture-cms.example.test",
      database: { name: "fixture_db", id: 56 },
      systemUser: { name: "fixture", id: 78 },
    },
    frontend: {
      worker: "fixture-fe",
      domain: "fixture-fe.example.test",
      d1: { name: "fixture-fe-publications", id: "d1-fixture" },
    },
    ci: {
      worker: "fixture-ci",
      workflows: ["fixture-ci", "fixture-mirror"],
      containerApplication: "fixture-ci-cisandbox",
    },
    artifacts: { namespace: "fixture", repo: "fixture" },
    github: { repository: "Example/fixture", head: HEAD_COMMIT },
    cloudflare: { accountId: "account-1", zoneId: "zone-1", zoneName: "example.test" },
    sigillo: { projectId: "PROJECT123" },
  });

  // gq.ops.json: archived, with the archive, and without the deleted Ploi site.
  const ops = await readOps(fixture);
  assert.deepEqual(ops.offboarded.archive, {
    bucket: "offboarded-clients",
    prefix,
    manifestSha256: sha256(manifestBody),
  });
  assert.equal(ops.offboarded.phase, "archived");
  assert.ok(Math.abs(Date.parse(ops.offboarded.at) - Date.now()) < 60_000);
  const { ploi, offboarded, ...rest } = ops;
  void offboarded;
  const { siteId, ...keptPloi } = OPS.ploi;
  void siteId;
  assert.deepEqual(ploi, keptPloi);
  const { ploi: _ploi, ...restBefore } = OPS;
  void _ploi;
  assert.deepEqual(rest, restBefore, "nothing else in gq.ops.json changes");

  assert.match(
    result.stdout,
    new RegExp(
      `r2://offboarded-clients/${prefix} \\(manifest\\.json sha256 ${sha256(manifestBody)}\\)`,
      "u",
    ),
  );
  assert.match(result.stdout, /https:\/\/github\.com\/Example\/fixture \(archived, read-only\)/u);
  assert.match(result.stdout, /Sigillo project PROJECT123, kept/u);
});

test("offboard --archive deletes nothing that isn't the Site's", async () => {
  const { fixture, account } = await cutSite();
  const { state } = account;

  const result = await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, ...account });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(state.workers, ["other-fe"]);
  assert.deepEqual(
    state.d1.map(({ uuid }) => uuid),
    ["d1-other"],
  );
  assert.deepEqual(state.workflows, ["other-ci"]);
  assert.deepEqual(
    state.containers.map(({ id }) => id),
    ["c-other"],
  );
  assert.deepEqual(Object.keys(state.buckets).sort(), ["offboarded-clients", "other-media"]);
  assert.deepEqual(Object.keys(state.buckets["other-media"]), ["x.jpg"]);
  assert.deepEqual(state.artifacts, [{ namespace: "other", name: "other" }]);
  assert.deepEqual(
    state.databases.map(({ id }) => id),
    [57],
  );
  assert.deepEqual(
    state.systemUsers.map(({ id }) => id),
    [79],
  );
  assert.deepEqual(
    state.hooks.map(({ id }) => id),
    [100],
  );
  assert.deepEqual(
    state.tokens.map(({ id }) => id),
    ["manager", "other"],
    "the manager token, another project's, and no temporary token, are left",
  );
});

// --- verification ------------------------------------------------------------

// `account.fetch`, except that `override(request)` may answer first.
function intercepting(account, override) {
  return recordingFetch(
    async (request) => (await override(request)) ?? account.fetch(request.url, request),
  );
}

// A bucket's objects as they are now: key → { bytes, lastModified }.
const snapshot = (objects) =>
  Object.fromEntries(
    Object.entries(objects).map(([key, { body, lastModified }]) => [
      key,
      { bytes: body.toString("hex"), lastModified },
    ]),
  );

const isArchive = (url) => new URL(url).pathname.startsWith("/offboarded-clients/");

async function assertNothingDeleted(fixture, account) {
  assert.deepEqual(account.state.log, ["bucket offboarded-clients created", "database backed up"]);
  const ops = await readOps(fixture);
  assert.deepEqual(ops.offboarded.phase, "cut");
  assert.equal(ops.offboarded.archive, undefined, "no archive is recorded");
  assert.equal(ops.ploi.siteId, "34");
  assert.equal(account.state.site.status, "suspended");
  assert.deepEqual(
    account.state.tokens
      .filter(({ name }) => name.startsWith("GETQUICK FIXTURE "))
      .map(({ status }) => status),
    ["disabled", "disabled", "disabled", "disabled"],
  );
  assert.ok(
    account.state.tokens.every(({ id }) => !id.startsWith("temp-")),
    "every temporary token is deleted",
  );
}

test("an archived file that reads back differently stops the archive before anything is deleted", async () => {
  const { fixture, account } = await cutSite();
  const fetch = intercepting(account, async ({ method, url }) => {
    if (method === "GET" && isArchive(url) && url.includes("/database.sql.gz")) {
      return new Response("dumq");
    }
  });

  const result = await fixture.run(["offboard", "--archive", "--yes"], {
    env: ENV,
    fetch,
    exec: account.exec,
  });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    new RegExp(
      `The archive at r2://offboarded-clients/fixture/${today()}/ failed verification: database\\.sql\\.gz's sha256 differs\\. Nothing was deleted; run gq offboard --archive again to archive it anew\\.`,
      "u",
    ),
  );
  await assertNothingDeleted(fixture, account);
});

test("uploads.zip holding fewer entries than the media bucket has objects stops the archive", async () => {
  const { fixture, account } = await cutSite();
  // An upload lands in the media bucket while uploads.zip is being written.
  const fetch = intercepting(account, async (request) => {
    const response = await account.fetch(request.url, request);
    if (
      request.method === "PUT" &&
      isArchive(request.url) &&
      request.url.includes("/uploads.zip")
    ) {
      account.state.buckets["fixture-media"]["late.jpg"] = {
        body: Buffer.from("late"),
        lastModified: new Date().toISOString(),
      };
    }
    return response;
  });

  const result = await fixture.run(["offboard", "--archive", "--yes"], {
    env: ENV,
    fetch,
    exec: account.exec,
  });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /failed verification: uploads\.zip holds 3 entries, but fixture-media has 4 objects\. Nothing was deleted/u,
  );
  await assertNothingDeleted(fixture, account);
});

test("no deletion request is sent before the archive is read back", async () => {
  const { fixture, account } = await cutSite();

  const result = await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, ...account });

  assert.equal(result.code, 0, result.stderr);
  const requests = account.fetch.requests;
  const lastArchiveRead = requests.findLastIndex(
    ({ method, url }) => method === "GET" && isArchive(url),
  );
  const firstDeletion = requests.findIndex(
    ({ method, url }) => method === "DELETE" && !/\/tokens\/temp-/u.test(url),
  );
  assert.ok(
    lastArchiveRead > 0 && firstDeletion > lastArchiveRead,
    `${lastArchiveRead} < ${firstDeletion}`,
  );
  // Every file but manifest.json was written before; each is read back.
  const reads = requests
    .filter(({ method, url }) => method === "GET" && isArchive(url) && !url.includes("list-type"))
    .map(({ url }) => decodeURIComponent(new URL(url).pathname.split("/").slice(4).join("/")));
  assert.deepEqual(
    new Set(reads),
    new Set([
      "uploads.zip",
      "database.sql.gz",
      "publications.sql",
      "backups/fixture_db/2026-09-30T10-00-00Z.sql.gz",
      ...reads.filter((path) => /^backups\/fixture_db\/2026-1/u.test(path)),
      "gq.ops.json",
      "manifest.json",
    ]),
  );
});

// --- the shared zone and the tokens -------------------------------------------

test("offboard --archive deletes only the Site's own hosts' records from the shared zone", async () => {
  const { fixture, account } = await cutSite();

  const result = await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, ...account });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    account.state.dnsRecords.map(({ id }) => id),
    ["r-other", "r-sub", "r-apex"],
    "another Site's host, a host under the Site's and the apex stay",
  );
  const zoneChanges = changes(account.fetch).filter((change) => change.includes("/zones/"));
  assert.deepEqual(zoneChanges, [
    "DELETE /client/v4/zones/zone-1/dns_records/r-cms",
    "DELETE /client/v4/zones/zone-1/dns_records/r-fe",
    "DELETE /client/v4/zones/zone-1/dns_records/r-media",
  ]);
});

test("the project's tokens are deleted after everything else on Cloudflare, and kept when that fails", async () => {
  const { fixture, account } = await cutSite();
  const fetch = intercepting(account, ({ method, url }) => {
    if (method === "DELETE" && url.endsWith("/dns_records/r-media")) {
      return new Response(JSON.stringify({ success: false, errors: [{ message: "boom" }] }), {
        status: 500,
      });
    }
  });

  const result = await fixture.run(["offboard", "--archive", "--yes"], {
    env: ENV,
    fetch,
    exec: account.exec,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /dns_records\/r-media failed: boom/u);
  assert.ok(
    !account.state.log.some((entry) => /^token t-/u.test(entry)),
    account.state.log.join("\n"),
  );
  assert.deepEqual(
    account.state.tokens.map(({ id }) => id),
    ["manager", "t-alchemy", "t-releases", "t-media", "t-deploy", "other"],
  );
  assert.equal(account.state.hooks.length, 2, "GitHub comes after the tokens");
});

// --- rerunning ------------------------------------------------------------------

test("offboard --archive after a failed deletion resumes where it stopped, without archiving again", async () => {
  const { fixture, account } = await cutSite();
  const failing = intercepting(account, ({ method, url }) => {
    if (method === "DELETE" && url.endsWith("/workers/scripts/fixture-ci")) {
      return new Response(JSON.stringify({ success: false, errors: [{ message: "boom" }] }), {
        status: 500,
      });
    }
  });
  const first = await fixture.run(["offboard", "--archive", "--yes"], {
    env: ENV,
    fetch: failing,
    exec: account.exec,
  });
  assert.equal(first.code, 1);
  assert.deepEqual(account.state.log.slice(-3), [
    "ploi system user 78 deleted",
    "worker fixture-fe deleted",
    "d1 d1-fixture deleted",
  ]);
  const recorded = await readOps(fixture);
  assert.equal(recorded.offboarded.phase, "cut");
  assert.equal(recorded.offboarded.archive.prefix, `fixture/${today()}/`);
  assert.equal(recorded.ploi.siteId, undefined, "the deleted site is forgotten");
  const archived = snapshot(account.state.buckets["offboarded-clients"]);

  // Neither the cut nor the restore can run over a Site being archived.
  const cut = await fixture.run(["offboard", "--yes"], { env: ENV, ...account });
  assert.equal(cut.code, 1);
  assert.match(cut.stderr, /fixture is being archived .*finish it with gq offboard --archive/u);
  const restore = await fixture.run(["offboard", "--restore", "--yes"], { env: ENV, ...account });
  assert.equal(restore.code, 1);
  assert.match(restore.stderr, /fixture was archived .*nothing to restore/u);

  account.state.log.length = 0;
  account.fetch.requests.length = 0;
  const rerun = await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, ...account });

  assert.equal(rerun.code, 0, rerun.stderr);
  assert.match(
    rerun.stdout,
    new RegExp(
      `✓ Archive: r2://offboarded-clients/fixture/${today()}/ is verified and recorded`,
      "u",
    ),
  );
  assert.match(rerun.stdout, /✓ Ploi: the site fixture-cms\.example\.test is deleted/u);
  assert.match(rerun.stdout, /✓ Frontend: the Worker fixture-fe is deleted/u);
  assert.ok(
    !account.fetch.requests.some(({ method, url }) => method !== "GET" && isArchive(url)),
    "nothing is written to the archive again",
  );
  assert.deepEqual(snapshot(account.state.buckets["offboarded-clients"]), archived);
  assertLog(account.state.log, DELETIONS.slice(DELETIONS.indexOf("worker fixture-ci deleted")));
  const ops = await readOps(fixture);
  assert.equal(ops.offboarded.phase, "archived");
  assert.deepEqual(ops.offboarded.archive, recorded.offboarded.archive);
});

test("offboard --archive refuses to go on when the recorded archive's manifest changed", async () => {
  const { fixture, account } = await cutSite();
  const failing = intercepting(account, ({ method, url }) => {
    if (method === "DELETE" && url.endsWith("/workers/scripts/fixture-ci")) {
      return new Response(JSON.stringify({ success: false, errors: [{ message: "boom" }] }), {
        status: 500,
      });
    }
  });
  assert.equal(
    (
      await fixture.run(["offboard", "--archive", "--yes"], {
        env: ENV,
        fetch: failing,
        exec: account.exec,
      })
    ).code,
    1,
  );
  const key = `fixture/${today()}/manifest.json`;
  account.state.buckets["offboarded-clients"][key].body = Buffer.from("{}");
  account.state.log.length = 0;

  const result = await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, ...account });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    new RegExp(
      `r2://offboarded-clients/${key} doesn't match gq\\.ops\\.json offboarded\\.archive: stopping before anything else is deleted\\.`,
      "u",
    ),
  );
  assert.deepEqual(account.state.log, []);
});

test("offboard --archive once archived has nothing left to do and calls no provider", async () => {
  const { fixture, account } = await cutSite();
  assert.equal(
    (await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, ...account })).code,
    0,
  );
  account.fetch.requests.length = 0;
  account.exec.calls.length = 0;

  const result = await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, ...account });

  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(
      `Nothing left to archive: fixture was archived to r2://offboarded-clients/fixture/${today()}/\\.`,
      "u",
    ),
  );
  assert.deepEqual(account.fetch.requests, []);
  assert.deepEqual(account.exec.calls, []);
  const restore = await fixture.run(["offboard", "--restore", "--yes"], { env: ENV, ...account });
  assert.equal(restore.code, 1);
  assert.match(restore.stderr, /fixture was archived .*nothing to restore/u);
});

// --- confirmation and configuration ---------------------------------------------

test("offboard --archive without a terminal or --yes shows the plan and changes nothing", async () => {
  const { fixture, account } = await cutSite();

  const result = await fixture.run(["offboard", "--archive"], { env: ENV, ...account });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /- Ploi: delete the site fixture-cms\.example\.test/u);
  assert.match(result.stderr, /Not a TTY: re-run with --yes to apply, or --dry-run to inspect\./u);
  assert.deepEqual(account.state.log, []);
});

test("in a terminal, offboard --archive goes on only once the project's name is typed back", async () => {
  const { fixture, account } = await cutSite();

  const wrong = await fixture.run(["offboard", "--archive"], {
    env: ENV,
    ...account,
    stdin: answering(["lombardi\r"]),
    interactive: true,
  });
  assert.equal(wrong.code, 0, wrong.stderr);
  assert.match(wrong.stdout, /Type fixture to go on/u);
  assert.match(wrong.stdout, /Nothing changed\./u);
  assert.deepEqual(account.state.log, []);

  const stdin = answering(["fixture\r"]);
  const right = await fixture.run(["offboard", "--archive"], {
    env: ENV,
    ...account,
    stdin,
    interactive: true,
  });
  assert.equal(right.code, 0, right.stderr);
  assert.equal(stdin.prompts, 1);
  assert.equal((await readOps(fixture)).offboarded.phase, "archived");
});

test("offboard --archive names the gq.ops.json keys the archive needs", async () => {
  const { artifacts, ci, ...ops } = OPS;
  void artifacts;
  const fixture = await offboardingSite({
    ops: {
      ...ops,
      ci: { worker: ci.worker },
      offboarded: { at: "2026-10-01T09:00:00.000Z", phase: "cut" },
    },
  });

  const result = await fixture.run(["offboard", "--archive", "--dry-run"], { env: ENV });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /gq\.ops\.json ci\.backupBucket, artifacts\.namespace, artifacts\.repo are required to archive\./u,
  );
});

test("--restore and --archive can't be combined", async () => {
  const fixture = await offboardingSite();

  const result = await fixture.run(["offboard", "--restore", "--archive"], { env: ENV });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /--restore and --archive can't be combined\./u);
});

test("an uploads.zip larger than one part goes up as a multipart upload", async () => {
  const { fixture, account } = await cutSite();
  const large = Buffer.alloc(17 * 1024 * 1024, 7);
  account.state.buckets["fixture-media"]["video/large.mp4"] = {
    body: large,
    lastModified: "2026-09-01T10:00:00.000Z",
  };
  account.state.buckets["fixture-media"]["empty.txt"] = {
    body: Buffer.alloc(0),
    lastModified: "2026-09-01T10:00:00.000Z",
  };

  const result = await fixture.run(["offboard", "--archive", "--yes"], { env: ENV, ...account });

  assert.equal(result.code, 0, result.stderr);
  const zipKey = `/offboarded-clients/fixture/${today()}/uploads.zip`;
  const uploads = account.fetch.requests
    .filter(({ method, url }) => method !== "GET" && new URL(url).pathname === zipKey)
    .map(({ method, url }) => {
      const query = new URL(url).searchParams;
      return `${method} ${["uploads", "partNumber", "uploadId"].filter((name) => query.has(name)).join(",")}`;
    });
  assert.deepEqual(uploads, [
    "POST uploads",
    "PUT partNumber,uploadId",
    "PUT partNumber,uploadId",
    "POST uploadId",
  ]);
  const archived =
    account.state.buckets["offboarded-clients"][zipKey.slice("/offboarded-clients/".length)];
  const entries = readZip(archived.body);
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.find(({ name }) => name === "video/large.mp4").body, large);
  assert.equal(entries.find(({ name }) => name === "empty.txt").body.length, 0);
});
