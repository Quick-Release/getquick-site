// While gq.ops.json records `offboarded`, every command that would expose the
// Site again refuses before it reads a secret or calls a provider, and the
// read-only ones keep working. At the run() seam; the generated deploy
// scripts' own refusal is in test/sync/deploy-files.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { recordingExec, recordingFetch } from "../support/fixture-site.mjs";
import { ENV, fakeAccount, offboardingSite, OPS, STAGING } from "../support/offboarding.mjs";

const OFFBOARDED = Object.freeze({
  ...OPS,
  offboarded: { at: "2026-10-01T09:00:00.000Z", phase: "cut" },
});

const GUARDED = [
  ["cloudflare", "media"],
  ["cloudflare", "deploy-token"],
  ["cloudflare", "ci"],
  ["cloudflare", "releases"],
  ["github", "setup"],
  ["ci", "deploy"],
  ["ploi", "provision", "--yes"],
  ["ploi", "events"],
  ["ploi", "media"],
  ["ploi", "release"],
  ["release", "push", "fix"],
  ["release", "tag"],
  ["frontend", "refresh"],
  ["frontend", "secrets"],
  ["ploi", "api", "sites.resume-site", "--yes"],
];

for (const argv of GUARDED) {
  test(`gq ${argv.join(" ")} refuses while the Site is offboarded`, async () => {
    const fixture = await offboardingSite({ ops: OFFBOARDED });
    const fetch = recordingFetch();
    const exec = recordingExec();

    const result = await fixture.run(argv, { env: { ...ENV, ...STAGING }, fetch, exec });

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /^gq: fixture is offboarded \(gq\.ops\.json offboarded: cut on 2026-10-01\): gq .+ would expose it again\. If the Site is coming back, run gq offboard --restore first \(pnpm offboard:restore\)\.\n$/u,
    );
    assert.deepEqual(fetch.requests, []);
    assert.deepEqual(exec.calls, []);
  });
}

test("an archived Site's guard says there is nothing to restore", async () => {
  const fixture = await offboardingSite({
    ops: { ...OPS, offboarded: { at: "2026-10-02T09:00:00.000Z", phase: "archived" } },
  });

  const result = await fixture.run(["ploi", "release"], { env: STAGING });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /fixture is offboarded \(gq\.ops\.json offboarded: archived on 2026-10-02\): gq ploi release would expose it again\. Its infrastructure is deleted\./u,
  );
});

test("a Site being archived points its guard at finishing the archive", async () => {
  const fixture = await offboardingSite({
    ops: {
      ...OPS,
      offboarded: {
        at: "2026-10-02T09:00:00.000Z",
        phase: "cut",
        archive: {
          bucket: "offboarded-clients",
          prefix: "fixture/2026-10-02/",
          manifestSha256: "a".repeat(64),
        },
      },
    },
  });

  const result = await fixture.run(["cloudflare", "media"], { env: STAGING });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /fixture is offboarded \(gq\.ops\.json offboarded: cut on 2026-10-02\): gq cloudflare media would expose it again\. Its archive is under way: finish it with gq offboard --archive \(pnpm offboard:archive\)\.\n$/u,
  );
});

test("a Site that isn't offboarded runs the guarded commands as before", async () => {
  const fixture = await offboardingSite();

  const result = await fixture.run(["ploi", "release"], { env: {} });

  assert.equal(result.code, 1);
  assert.doesNotMatch(result.stderr, /offboarded/u);
});

test("read-only commands keep working while the Site is offboarded", async () => {
  const fixture = await offboardingSite({ ops: OFFBOARDED });
  const { fetch, exec, state } = fakeAccount();

  const backup = await fixture.run(["db", "backup"], { env: STAGING, fetch, exec });
  assert.equal(backup.code, 0, backup.stderr);
  assert.deepEqual(state.log, ["database backed up"]);

  const read = await fixture.run(["ploi", "api", "sites.get-site", "--path", "site=34"], {
    env: STAGING,
    fetch,
    exec,
  });
  assert.equal(read.code, 0, read.stderr);
  assert.match(read.stdout, /"domain": "fixture-cms\.example\.test"/u);

  const dryRun = await fixture.run(["ploi", "api", "sites.resume-site", "--dry-run"], {
    env: STAGING,
  });
  assert.equal(dryRun.code, 0, dryRun.stderr);

  const plan = await fixture.run(["offboard", "--dry-run"], { env: ENV, fetch, exec });
  assert.equal(plan.code, 0, plan.stderr);
});
