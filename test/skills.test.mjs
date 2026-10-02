import assert from "node:assert/strict";
import { access, chmod, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  createFixtureSite,
  json,
  recordingFetch,
  runGq,
  temporaryDirectory,
} from "./support/fixture-site.mjs";

const REPOSITORY = "acme/skills";

test("gq skills update installs registered upstream skills and writes skills-lock.json", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        "code-review": {
          repository: REPOSITORY,
          path: "skills/code-review",
          ref: "main",
          trackingBranch: "main",
        },
      }),
      ".agents/skills/local/SKILL.md": "# Local only\n",
    },
  });

  const upstream = commitFiles({
    "skills/code-review": {
      "SKILL.md": "# Upstream code review\n",
      "agents/openai.yaml": "model: gpt-5\n",
    },
  });
  const fetch = githubFetch({
    commits: { main: "c1" },
    trees: { c1: upstream.tree },
    blobs: upstream.blobs,
  });

  const result = await fixture.run(["skills", "update"], { fetch });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^\.agents\/skills\/code-review: installed /mu);
  assert.equal(
    await readFile(fixture.path(".agents/skills/code-review/SKILL.md"), "utf8"),
    "# Upstream code review\n",
  );
  assert.equal(
    await readFile(fixture.path(".agents/skills/code-review/agents/openai.yaml"), "utf8"),
    "model: gpt-5\n",
  );
  assert.equal(
    await readFile(fixture.path(".agents/skills/local/SKILL.md"), "utf8"),
    "# Local only\n",
  );

  const lock = JSON.parse(await readFile(fixture.path("skills-lock.json"), "utf8"));
  assert.equal(lock.schemaVersion, 1);
  assert.deepEqual(lock.skills["code-review"].source, {
    repository: REPOSITORY,
    path: "skills/code-review",
    ref: "main",
    trackingBranch: "main",
  });
  assert.equal(lock.skills["code-review"].installedCommit, "c1");
  assert.deepEqual(Object.keys(lock.skills["code-review"].files).sort(), [
    "SKILL.md",
    "agents/openai.yaml",
  ]);
});

test("gq skills update bootstraps an existing registered skill when it exactly matches upstream", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
      ".agents/skills/tdd/SKILL.md": "# TDD\n",
      ".agents/skills/tdd/agents/openai.yaml": "model: gpt-5\n",
    },
  });

  const upstream = commitFiles({
    "skills/tdd": {
      "SKILL.md": "# TDD\n",
      "agents/openai.yaml": "model: gpt-5\n",
    },
  });

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: upstream.tree },
      blobs: upstream.blobs,
    }),
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /recorded existing upstream copy/);

  const lock = JSON.parse(await readFile(fixture.path("skills-lock.json"), "utf8"));
  assert.equal(lock.skills.tdd.installedCommit, "c1");
  assert.deepEqual(Object.keys(lock.skills.tdd.files).sort(), ["SKILL.md", "agents/openai.yaml"]);
});

test("gq skills update refuses to overwrite a manually installed registered skill that differs from upstream", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
      ".agents/skills/tdd/SKILL.md": "# Local only\n",
    },
  });

  const upstream = commitFiles({ "skills/tdd": { "SKILL.md": "# Upstream\n" } });
  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: upstream.tree },
      blobs: upstream.blobs,
    }),
  });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /exists without skills-lock\.json and differs from registered upstream/,
  );
  assert.equal(
    await readFile(fixture.path(".agents/skills/tdd/SKILL.md"), "utf8"),
    "# Local only\n",
  );
  await assert.rejects(() => access(fixture.path("skills-lock.json")));
});

test("gq skills update --check is read-only and exits 1 when updates are available", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        "code-review": {
          repository: REPOSITORY,
          path: "skills/code-review",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const first = commitFiles({ "skills/code-review": { "SKILL.md": "# v1\n" } });
  const second = commitFiles({ "skills/code-review": { "SKILL.md": "# v2\n" } });

  await fixture.run(["skills", "update"], {
    fetch: githubFetch({ commits: { main: "c1" }, trees: { c1: first.tree }, blobs: first.blobs }),
  });
  const lockBefore = await readFile(fixture.path("skills-lock.json"), "utf8");

  const result = await fixture.run(["skills", "update", "--check"], {
    fetch: githubFetch({
      commits: { main: "c2" },
      trees: { c2: second.tree },
      blobs: second.blobs,
    }),
  });

  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stdout, /update available/);
  assert.equal(
    await readFile(fixture.path(".agents/skills/code-review/SKILL.md"), "utf8"),
    "# v1\n",
  );
  assert.equal(await readFile(fixture.path("skills-lock.json"), "utf8"), lockBefore);
});

test("gq skills update works from a nested cwd and reports up to date", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const snapshot = commitFiles({ "skills/tdd": { "SKILL.md": "# TDD\n" } });
  await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: snapshot.tree },
      blobs: snapshot.blobs,
    }),
  });

  const nested = fixture.path("apps", "frontend", "src");
  await mkdir(nested, { recursive: true });
  const result = await runGq(["skills", "update"], {
    cwd: nested,
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: snapshot.tree },
      blobs: snapshot.blobs,
    }),
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "Skills: up to date.\n");
});

test("a second gq skills update is blocked while another write update is running", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const snapshot = commitFiles({ "skills/tdd": { "SKILL.md": "# TDD\n" } });
  const barrier = deferred();
  const release = deferred();

  const firstFetch = githubFetch({
    commits: { main: "c1" },
    trees: { c1: snapshot.tree },
    blobs: snapshot.blobs,
    onRequest: async ({ url }) => {
      if (!url.endsWith("/commits/main") || barrier.settled) return;
      barrier.resolve();
      await release.promise;
    },
  });

  const firstRun = fixture.run(["skills", "update"], { fetch: firstFetch });
  await barrier.promise;

  const secondFetch = githubFetch({
    commits: { main: "c1" },
    trees: { c1: snapshot.tree },
    blobs: snapshot.blobs,
  });
  const blocked = await fixture.run(["skills", "update"], { fetch: secondFetch });

  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /already running \(lock: \.gq-skills-update\.lock\)/);
  assert.equal(secondFetch.requests.length, 0);

  release.resolve();
  const firstResult = await firstRun;
  assert.equal(firstResult.code, 0, firstResult.stderr);
});

test("gq skills update refuses local drift in managed skills", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        "code-review": {
          repository: REPOSITORY,
          path: "skills/code-review",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const snapshot = commitFiles({ "skills/code-review": { "SKILL.md": "# Stable\n" } });
  await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: snapshot.tree },
      blobs: snapshot.blobs,
    }),
  });

  await writeFile(fixture.path(".agents/skills/code-review/SKILL.md"), "# Local edit\n");
  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: snapshot.tree },
      blobs: snapshot.blobs,
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /local drift detected/);
  assert.equal(
    await readFile(fixture.path(".agents/skills/code-review/SKILL.md"), "utf8"),
    "# Local edit\n",
  );
});

test("gq skills update removes supporting files deleted upstream", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        "code-review": {
          repository: REPOSITORY,
          path: "skills/code-review",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const first = commitFiles({
    "skills/code-review": {
      "SKILL.md": "# V1\n",
      "notes/extra.md": "extra\n",
    },
  });
  const second = commitFiles({
    "skills/code-review": {
      "SKILL.md": "# V2\n",
    },
  });

  await fixture.run(["skills", "update"], {
    fetch: githubFetch({ commits: { main: "c1" }, trees: { c1: first.tree }, blobs: first.blobs }),
  });

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c2" },
      trees: { c2: second.tree },
      blobs: second.blobs,
    }),
  });

  assert.equal(result.code, 0, result.stderr);
  await assert.rejects(() => access(fixture.path(".agents/skills/code-review/notes/extra.md")));
  const lock = JSON.parse(await readFile(fixture.path("skills-lock.json"), "utf8"));
  assert.deepEqual(Object.keys(lock.skills["code-review"].files), ["SKILL.md"]);
});

test("gq skills update rejects unsafe upstream symlinks", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const tree = [
    { path: "skills/tdd", mode: "040000", type: "tree", sha: "tree1" },
    { path: "skills/tdd/SKILL.md", mode: "120000", type: "blob", sha: "blob1" },
  ];

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: tree },
      blobs: { blob1: "../outside" },
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /symlink/);
  await assert.rejects(() => access(fixture.path("skills-lock.json")));
});

test("gq skills update rejects upstream skills with more than 500 files", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        huge: {
          repository: REPOSITORY,
          path: "skills/huge",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const tree = [{ path: "skills/huge", mode: "040000", type: "tree", sha: "tree-huge" }];
  for (let index = 0; index < 501; index += 1) {
    tree.push({
      path: `skills/huge/file-${index}.md`,
      mode: "100644",
      type: "blob",
      sha: `blob-${index}`,
    });
  }

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({ commits: { main: "c1" }, trees: { c1: tree }, blobs: {} }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /has 501 files; limit is 500/);
});

test("gq skills update rejects blobs that exceed per-file size cap from declared size", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const tree = [
    { path: "skills/tdd", mode: "040000", type: "tree", sha: "tree" },
    { path: "skills/tdd/SKILL.md", mode: "100644", type: "blob", sha: "blob" },
  ];

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: tree },
      blobs: { blob: { content: "tiny", size: 512 * 1024 + 1 } },
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /per-file limit is 524288/);
});

test("gq skills update rejects blobs with invalid encoded length before decoding", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const tree = [
    { path: "skills/tdd", mode: "040000", type: "tree", sha: "tree" },
    { path: "skills/tdd/SKILL.md", mode: "100644", type: "blob", sha: "blob" },
  ];

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: tree },
      blobs: { blob: { base64: "YWFhYQ==", size: 2 } },
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /encoded payload length .* does not match declared size/);
});

test("gq skills update rejects sources that exceed total size cap", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        huge: {
          repository: REPOSITORY,
          path: "skills/huge",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const tree = [{ path: "skills/huge", mode: "040000", type: "tree", sha: "tree-huge" }];
  const blobs = {};
  for (let index = 0; index < 11; index += 1) {
    const sha = `blob-${index}`;
    tree.push({
      path: `skills/huge/file-${index}.md`,
      mode: "100644",
      type: "blob",
      sha,
    });
    blobs[sha] = "a".repeat(500_000);
  }

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({ commits: { main: "c1" }, trees: { c1: tree }, blobs }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /exceeds 5242880 bytes/);
});

test("gq skills update rejects symlink anchors before any read/write", async () => {
  const fixture = await createFixtureSite({ ops: null });
  const outside = await temporaryDirectory();

  await symlink(outside, fixture.path(".agents"));
  let result = await fixture.run(["skills", "update"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\.agents must not be a symlink/);

  await writeFile(fixture.path(".agents-link-target.json"), registration({}));
  await rmAndRecreateDirectory(fixture.path(".agents"));
  await symlink(fixture.path(".agents-link-target.json"), fixture.path(".agents/skills.json"));
  result = await fixture.run(["skills", "update"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\.agents\/skills\.json must not be a symlink/);

  await rmAndRecreateDirectory(fixture.path(".agents"));
  await writeFile(fixture.path(".agents/skills.json"), registration({}));
  await writeFile(fixture.path("lock-target.json"), "{}\n");
  await symlink(fixture.path("lock-target.json"), fixture.path("skills-lock.json"));
  result = await fixture.run(["skills", "update"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /skills-lock\.json must not be a symlink/);
});

test("gq skills update rejects reserved skill keys and unsafe registration paths", async () => {
  const fixture = await createFixtureSite({ ops: null });
  await mkdir(fixture.path(".agents"), { recursive: true });

  await writeFile(
    fixture.path(".agents/skills.json"),
    '{\n  "schemaVersion": 1,\n  "skills": {\n    "__proto__": {\n      "repository": "acme/skills",\n      "path": "skills/tdd",\n      "ref": "main",\n      "trackingBranch": "main"\n    }\n  }\n}\n',
  );
  let result = await fixture.run(["skills", "update"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /reserved skill key/);

  await writeFile(
    fixture.path(".agents/skills.json"),
    '{\n  "schemaVersion": 1,\n  "skills": {\n    "tdd": {\n      "repository": "acme/skills",\n      "path": "skills\\\\tdd",\n      "ref": "main",\n      "trackingBranch": "main"\n    }\n  }\n}\n',
  );
  result = await fixture.run(["skills", "update"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /backslash is not allowed/);
});

test("gq skills update allows a skill named prototype", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        prototype: {
          repository: REPOSITORY,
          path: "skills/prototype",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const upstream = commitFiles({ "skills/prototype": { "SKILL.md": "# prototype\n" } });
  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: upstream.tree },
      blobs: upstream.blobs,
    }),
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\.agents\/skills\/prototype: installed/);
});

test("gq skills update caches GitHub commit/tree/blob requests by repository and ref", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        alpha: {
          repository: REPOSITORY,
          path: "skills/alpha",
          ref: "main",
          trackingBranch: "main",
        },
        beta: {
          repository: REPOSITORY,
          path: "skills/beta",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const sharedBlob = "blob-shared";
  const tree = [
    { path: "skills/alpha", mode: "040000", type: "tree", sha: "tree-alpha" },
    { path: "skills/alpha/SKILL.md", mode: "100644", type: "blob", sha: sharedBlob },
    { path: "skills/beta", mode: "040000", type: "tree", sha: "tree-beta" },
    { path: "skills/beta/SKILL.md", mode: "100644", type: "blob", sha: sharedBlob },
  ];

  const fetch = githubFetch({
    commits: { main: "c1" },
    trees: { c1: tree },
    blobs: { [sharedBlob]: "# Shared\n" },
  });
  const result = await fixture.run(["skills", "update"], { fetch });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fetch.requests.filter(({ url }) => url.endsWith("/commits/main")).length, 1);
  assert.equal(fetch.requests.filter(({ url }) => url.includes("/git/trees/c1")).length, 1);
  assert.equal(
    fetch.requests.filter(({ url }) => url.endsWith(`/git/blobs/${sharedBlob}`)).length,
    1,
  );
});

test("gq skills update does not chmod an existing .agents directory", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  await chmod(fixture.path(".agents"), 0o700);
  const upstream = commitFiles({ "skills/tdd": { "SKILL.md": "# TDD\n" } });

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: upstream.tree },
      blobs: upstream.blobs,
    }),
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal((await lstat(fixture.path(".agents"))).mode & 0o777, 0o700);
});

test("gq skills update explicitly sets file modes (644/755) despite restrictive umask", async (t) => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const previousUmask = process.umask(0o077);
  t.after(() => {
    process.umask(previousUmask);
  });

  const upstream = commitFiles({
    "skills/tdd": {
      "SKILL.md": { content: "# TDD\n", mode: "100644" },
      "scripts/run.sh": { content: "#!/bin/sh\n", mode: "100755" },
    },
  });

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: upstream.tree },
      blobs: upstream.blobs,
    }),
  });

  assert.equal(result.code, 0, result.stderr);
  const regularMode = (await lstat(fixture.path(".agents/skills/tdd/SKILL.md"))).mode & 0o777;
  const executableMode =
    (await lstat(fixture.path(".agents/skills/tdd/scripts/run.sh"))).mode & 0o777;
  assert.equal(regularMode, 0o644);
  assert.equal(executableMode, 0o755);
});

test("gq skills update restores backed-up skill content when install fails after backup move", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const first = commitFiles({ "skills/tdd": { "SKILL.md": "# v1\n" } });
  await fixture.run(["skills", "update"], {
    fetch: githubFetch({ commits: { main: "c1" }, trees: { c1: first.tree }, blobs: first.blobs }),
  });

  const second = commitFiles({ "skills/tdd": { "SKILL.md": "# v2\n" } });
  const result = await fixture.run(["skills", "update"], {
    env: { GQ_TEST_SKILLS_FAIL_AFTER_BACKUP: "tdd" },
    fetch: githubFetch({
      commits: { main: "c2" },
      trees: { c2: second.tree },
      blobs: second.blobs,
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Skills update transaction failed/);
  assert.equal(await readFile(fixture.path(".agents/skills/tdd/SKILL.md"), "utf8"), "# v1\n");
  const lock = JSON.parse(await readFile(fixture.path("skills-lock.json"), "utf8"));
  assert.equal(lock.skills.tdd.installedCommit, "c1");
});

test("gq skills update removes a newly written lock on rollback when no previous lock existed", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const upstream = commitFiles({ "skills/tdd": { "SKILL.md": "# new\n" } });
  const result = await fixture.run(["skills", "update"], {
    env: { GQ_TEST_SKILLS_FAIL_AFTER_LOCK: "1" },
    fetch: githubFetch({
      commits: { main: "c1" },
      trees: { c1: upstream.tree },
      blobs: upstream.blobs,
    }),
  });

  assert.equal(result.code, 1);
  await assert.rejects(() => access(fixture.path("skills-lock.json")));
  await assert.rejects(() => access(fixture.path(".agents/skills/tdd/SKILL.md")));
});

test("gq skills update rechecks drift before apply when files change during fetch", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const first = commitFiles({ "skills/tdd": { "SKILL.md": "# stable\n" } });
  await fixture.run(["skills", "update"], {
    fetch: githubFetch({ commits: { main: "c1" }, trees: { c1: first.tree }, blobs: first.blobs }),
  });

  const second = commitFiles({ "skills/tdd": { "SKILL.md": "# upstream\n" } });
  let edited = false;
  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c2" },
      trees: { c2: second.tree },
      blobs: second.blobs,
      onRequest: async ({ url }) => {
        if (edited || !url.endsWith("/commits/main")) return;
        edited = true;
        await writeFile(fixture.path(".agents/skills/tdd/SKILL.md"), "# local edit\n");
      },
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /local drift detected/);
  assert.equal(
    await readFile(fixture.path(".agents/skills/tdd/SKILL.md"), "utf8"),
    "# local edit\n",
  );
  const lock = JSON.parse(await readFile(fixture.path("skills-lock.json"), "utf8"));
  assert.equal(lock.skills.tdd.installedCommit, "c1");
});

test("gq skills update rolls back skill writes when lock install fails with existing lock", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        tdd: {
          repository: REPOSITORY,
          path: "skills/tdd",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const first = commitFiles({ "skills/tdd": { "SKILL.md": "# v1\n" } });
  await fixture.run(["skills", "update"], {
    fetch: githubFetch({ commits: { main: "c1" }, trees: { c1: first.tree }, blobs: first.blobs }),
  });

  const second = commitFiles({ "skills/tdd": { "SKILL.md": "# v2\n" } });
  const result = await fixture.run(["skills", "update"], {
    env: { GQ_TEST_SKILLS_FAIL_AFTER_LOCK: "1" },
    fetch: githubFetch({
      commits: { main: "c2" },
      trees: { c2: second.tree },
      blobs: second.blobs,
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Skills update transaction failed/);
  assert.equal(await readFile(fixture.path(".agents/skills/tdd/SKILL.md"), "utf8"), "# v1\n");
  const lock = JSON.parse(await readFile(fixture.path("skills-lock.json"), "utf8"));
  assert.equal(lock.skills.tdd.installedCommit, "c1");
});

test("gq skills update stages all updates before writes when an upstream fetch fails", async () => {
  const fixture = await createFixtureSite({
    ops: null,
    files: {
      ".agents/skills.json": registration({
        alpha: {
          repository: REPOSITORY,
          path: "skills/alpha",
          ref: "main",
          trackingBranch: "main",
        },
        beta: {
          repository: REPOSITORY,
          path: "skills/beta",
          ref: "main",
          trackingBranch: "main",
        },
      }),
    },
  });

  const first = commitFiles({
    "skills/alpha": { "SKILL.md": "# alpha v1\n" },
    "skills/beta": { "SKILL.md": "# beta v1\n" },
  });
  await fixture.run(["skills", "update"], {
    fetch: githubFetch({ commits: { main: "c1" }, trees: { c1: first.tree }, blobs: first.blobs }),
  });

  const second = commitFiles({
    "skills/alpha": { "SKILL.md": "# alpha v2\n" },
    "skills/beta": { "SKILL.md": "# beta v2\n" },
  });
  const missingBlob = Object.keys(second.blobs).find((sha) => second.blobs[sha] === "# beta v2\n");
  assert.ok(missingBlob);

  const result = await fixture.run(["skills", "update"], {
    fetch: githubFetch({
      commits: { main: "c2" },
      trees: { c2: second.tree },
      blobs: Object.fromEntries(
        Object.entries(second.blobs).filter(([sha]) => sha !== missingBlob),
      ),
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /GitHub API .*failed with HTTP 404/);
  assert.equal(
    await readFile(fixture.path(".agents/skills/alpha/SKILL.md"), "utf8"),
    "# alpha v1\n",
  );

  const lock = JSON.parse(await readFile(fixture.path("skills-lock.json"), "utf8"));
  assert.equal(lock.skills.alpha.installedCommit, "c1");
});

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = () => {
      state.settled = true;
      nextResolve();
    };
  });
  const state = { promise, resolve, settled: false };
  return state;
}

function registration(skills) {
  return `${JSON.stringify({ schemaVersion: 1, skills }, null, 2)}\n`;
}

async function rmAndRecreateDirectory(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

function commitFiles(skillsByPath) {
  const tree = [];
  const blobs = {};
  let counter = 1;

  for (const sourcePath of Object.keys(skillsByPath).sort()) {
    tree.push({ path: sourcePath, mode: "040000", type: "tree", sha: `tree-${counter}` });
    const files = skillsByPath[sourcePath];
    for (const filePath of Object.keys(files).sort()) {
      const descriptor =
        typeof files[filePath] === "string"
          ? { content: files[filePath], mode: "100644" }
          : { content: files[filePath].content, mode: files[filePath].mode || "100644" };
      const blobSha = `blob-${counter}`;
      counter += 1;
      tree.push({
        path: `${sourcePath}/${filePath}`,
        mode: descriptor.mode,
        type: "blob",
        sha: blobSha,
      });
      blobs[blobSha] = descriptor.content;
    }
  }

  return { tree, blobs };
}

function githubFetch({ commits, trees, blobs, onRequest }) {
  return recordingFetch(async (request) => {
    if (onRequest) await onRequest(request);
    const { url } = request;
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.origin !== "https://api.github.com") {
      return json({ message: `Unexpected origin: ${parsed.origin}` }, 500);
    }
    if (parts[0] !== "repos" || `${parts[1]}/${parts[2]}` !== REPOSITORY) {
      return json({ message: "Not Found" }, 404);
    }

    if (parts[3] === "commits") {
      const ref = decodeURIComponent(parts.slice(4).join("/"));
      const sha = commits[ref];
      return sha ? { sha } : json({ message: "Not Found" }, 404);
    }

    if (parts[3] === "git" && parts[4] === "trees") {
      const sha = decodeURIComponent(parts[5]);
      const tree = trees[sha];
      return tree ? { tree, truncated: false } : json({ message: "Not Found" }, 404);
    }

    if (parts[3] === "git" && parts[4] === "blobs") {
      const sha = decodeURIComponent(parts[5]);
      const entry = blobs[sha];
      if (entry === undefined) return json({ message: "Not Found" }, 404);

      if (typeof entry === "string") {
        return {
          encoding: "base64",
          content: Buffer.from(entry, "utf8").toString("base64"),
          size: Buffer.byteLength(entry, "utf8"),
        };
      }

      if (typeof entry === "object" && entry !== null) {
        const content =
          typeof entry.base64 === "string" ? entry.base64 : String(entry.content ?? "");
        return {
          encoding: entry.encoding ?? "base64",
          content:
            typeof entry.base64 === "string"
              ? entry.base64
              : Buffer.from(content, "utf8").toString("base64"),
          size:
            typeof entry.size === "number"
              ? entry.size
              : Buffer.byteLength(String(entry.content ?? ""), "utf8"),
        };
      }

      return json({ message: "Invalid blob fixture entry" }, 500);
    }

    return json({ message: `Unexpected endpoint: ${parsed.pathname}` }, 500);
  });
}
