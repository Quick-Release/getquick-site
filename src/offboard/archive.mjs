// Archiving an offboarded Site (phase 2, ADR 0011), as a plan steps.mjs's way:
// inspectArchive() reads, once, what is left to archive and delete;
// archivePlan() turns it into ordered items ("done", "todo" with its
// `apply`, or "manual"). The archive goes first: every media object
// (uploads.zip), a fresh database dump, the D1 store's export, the database
// backups, gq.ops.json and a manifest.json of them all, under
// r2://offboarded-clients/<project>/<UTC date>/. It is verified by reading it
// all back, and recorded in gq.ops.json (`offboarded.archive`) only then;
// nothing is deleted before. The deletions follow gq-smoke-down's order,
// with the project's tokens last, then GitHub, then the record.
//
// A rerun skips a recorded archive (it never archives over a verified one)
// and deletes only what is still there, so a failed run is finished by
// running it again.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { webhookUrl } from "../ci/github-setup.mjs";
import { updateManifest } from "../manifest/manifest.mjs";
import { VERSION } from "../version.mjs";
import { frontendWorker } from "./providers.mjs";
import { ZIP_TAIL_BYTES, zipEntryCount, zipStream } from "./zip.mjs";

// The private bucket every offboarded client's archive goes to.
export const ARCHIVE_BUCKET = "offboarded-clients";

// How many objects are deleted at once when a bucket is emptied.
const DELETE_CONCURRENCY = 8;

// What is left of an archived (or cut) Site, read through `providers`
// (withOffboardingProviders with `archive`). `now` dates a new archive.
export async function inspectArchive(providers, { now = () => new Date() } = {}) {
  const { ops, cloudflare, ploi, github } = providers;
  const frontend = frontendWorker(ops.project);
  const d1Name = `${frontend}-publications`;
  const workers = await cloudflare.workers();
  const workflows = await cloudflare.workflows();
  const containerName = `${ops.ci.worker}-cisandbox`;
  const buckets = [];
  const names = [ops.media.bucket, ops.releases.bucket, ops.backups.bucket, ops.ci.backupBucket];
  for (const name of new Set(names)) {
    buckets.push({ name, exists: await cloudflare.bucketExists(name) });
  }
  const mediaExists = buckets.find(({ name }) => name === ops.media.bucket).exists;
  const hosts = [ops.domains.admin, ops.domains.frontend, ops.media.domain];
  const records = [];
  for (const host of hosts) records.push(...(await cloudflare.dnsRecords(host)));
  const ciUrl = webhookUrl(ops.ci.worker, await cloudflare.accountSubdomain());

  return {
    ops,
    archive: await inspectContents(providers, { now }),
    ploi: {
      site: await ploi.existingSite(),
      database: (await ploi.databases()).find(({ name }) => name === ops.ploi.database),
      systemUser: (await ploi.systemUsers()).find(({ name }) => name === ops.ploi.systemUser),
    },
    frontend: {
      worker: frontend,
      exists: workers.includes(frontend),
      d1: await cloudflare.d1(d1Name),
      d1Name,
    },
    ci: {
      worker: ops.ci.worker,
      exists: workers.includes(ops.ci.worker),
      workflows: [ops.ci.worker, `${ops.project}-mirror`].filter((name) =>
        workflows.includes(name),
      ),
      container: (await cloudflare.containerApplications()).find(
        ({ name }) => name.toLowerCase() === containerName,
      ),
      hook: (await github.hooks()).find((hook) => hook.config?.url === ciUrl),
    },
    mediaDomain: mediaExists
      ? await cloudflare.bucketDomain(ops.media.bucket, ops.media.domain)
      : undefined,
    buckets,
    artifacts: await cloudflare.artifactsRepository(ops.artifacts.namespace, ops.artifacts.repo),
    records,
    tokens: await cloudflare.projectTokens(),
    repositoryArchived: await github.archived(),
  };
}

// The archive recorded in gq.ops.json (whose manifest.json must still be
// there, unchanged), or what a new one would hold.
async function inspectContents(providers, { now }) {
  const { ops, cloudflare, github } = providers;
  const recorded = ops.offboarded?.archive;
  if (recorded) {
    const bucket = await providers.r2(recorded.bucket);
    const manifest = await readBack(bucket, `${recorded.prefix}manifest.json`);
    if (manifest?.sha256 !== recorded.manifestSha256) {
      throw new Error(
        `r2://${recorded.bucket}/${recorded.prefix}manifest.json ${manifest ? "doesn't match" : "is missing, unlike"} gq.ops.json offboarded.archive: stopping before anything else is deleted.`,
      );
    }
    return { recorded };
  }
  const backupsPrefix = ops.backups.prefix ?? "db/";
  return {
    prefix: `${ops.project}/${now().toISOString().slice(0, 10)}/`,
    bucketExists: await cloudflare.bucketExists(ARCHIVE_BUCKET),
    media: await (await providers.r2(ops.media.bucket)).list(),
    backups: await (await providers.r2(ops.backups.bucket)).list(backupsPrefix),
    backupsPrefix,
    head: await github.headCommit(),
  };
}

const done = (area, text) => ({ area, state: "done", text });
const manual = (area, text) => ({ area, state: "manual", text });
const todo = (area, text, apply) => ({ area, state: "todo", text, apply });

// Archiving, verifying, then deleting, in order. `result()` is the recorded
// archive once the plan is applied.
export function archivePlan(site, { configPath, now = () => new Date() }) {
  const { ops, archive } = site;
  const session = {};
  const items = [
    ...archiveItems(site, { configPath, now, session }),
    ...deletionItems(site, { configPath }),
    todo("Record", 'offboarded.phase becomes "archived" in gq.ops.json (commit it)', () =>
      updateManifest(configPath, (manifest) => {
        manifest.offboarded = {
          at: now().toISOString(),
          phase: "archived",
          archive: manifest.offboarded.archive,
        };
      }),
    ),
    manual(
      "Sigillo",
      `the project ${ops.sigillo?.projectId ?? "(gq.ops.json sigillo.projectId)"} is kept, with the Site's secrets`,
    ),
  ];
  return { items, result: () => archive.recorded ?? session.recorded };
}

function archiveItems(site, { configPath, now, session }) {
  const { ops, archive } = site;
  if (archive.recorded) {
    const { bucket, prefix, manifestSha256 } = archive.recorded;
    return [
      done(
        "Archive",
        `r2://${bucket}/${prefix} is verified and recorded (manifest.json sha256 ${manifestSha256.slice(0, 12)}…); it is never archived again`,
      ),
    ];
  }
  const at = `r2://${ARCHIVE_BUCKET}/${archive.prefix}`;
  const d1 = site.frontend.d1;
  return [
    archive.bucketExists
      ? done("Archive", `the private bucket ${ARCHIVE_BUCKET} exists`)
      : todo("Archive", `create the private bucket ${ARCHIVE_BUCKET} (no custom domain)`, (p) =>
          p.cloudflare.createBucket(ARCHIVE_BUCKET),
        ),
    todo(
      "Archive",
      `${at}uploads.zip ← the ${archive.media.length} objects of ${ops.media.bucket}, keys kept`,
      async (p) => {
        session.files = [await archiveUploads(p, archive)];
      },
    ),
    todo("Archive", `${at}database.sql.gz ← a fresh dump of ${ops.ploi.database}`, async (p) => {
      const bucket = await p.r2(ARCHIVE_BUCKET);
      const dump = await p.dumpDatabase(
        await bucket.presignPut(`${archive.prefix}database.sql.gz`),
      );
      session.files.push({ path: "database.sql.gz", size: dump.bytes, sha256: dump.sha256 });
    }),
    d1
      ? todo("Archive", `${at}publications.sql ← the D1 store ${d1.name}`, async (p) => {
          const exported = await p.cloudflare.exportD1(d1.uuid);
          const bucket = await p.r2(ARCHIVE_BUCKET);
          const stored = await bucket.upload(
            `${archive.prefix}publications.sql`,
            exported.body,
            "application/sql",
          );
          session.files.push({ path: "publications.sql", ...stored });
        })
      : done("Archive", `there is no D1 store ${site.frontend.d1Name} to export`),
    todo(
      "Archive",
      `${at}backups/ ← the ${archive.backups.length} database backups in r2://${ops.backups.bucket}/${archive.backupsPrefix}`,
      async (p) => {
        const source = await p.r2(ops.backups.bucket);
        const bucket = await p.r2(ARCHIVE_BUCKET);
        for (const backup of await source.list(archive.backupsPrefix)) {
          const path = `backups/${backup.key.slice(archive.backupsPrefix.length)}`;
          const response = await source.get(backup.key);
          const stored = await bucket.upload(
            `${archive.prefix}${path}`,
            response.body ?? [],
            "application/gzip",
          );
          session.files.push({ path, ...stored });
        }
      },
    ),
    todo(
      "Archive",
      `${at}gq.ops.json, and manifest.json (each file's size and sha256, and the source resources)`,
      async (p) => {
        const bucket = await p.r2(ARCHIVE_BUCKET);
        const config = await readFile(configPath);
        const stored = await bucket.upload(
          `${archive.prefix}gq.ops.json`,
          [config],
          "application/json",
        );
        session.files.push({ path: "gq.ops.json", ...stored });
        session.manifest = manifestOf(site, session.files, now());
        const written = await bucket.upload(
          `${archive.prefix}manifest.json`,
          [Buffer.from(`${JSON.stringify(session.manifest, null, 2)}\n`)],
          "application/json",
        );
        session.manifestSha256 = written.sha256;
      },
    ),
    todo(
      "Verify",
      `re-read every archived file against manifest.json, and count uploads.zip's entries against ${ops.media.bucket}; nothing is deleted unless all match, then gq.ops.json records the archive`,
      async (p) => {
        await verifyArchive(p, archive.prefix, session);
        session.recorded = {
          bucket: ARCHIVE_BUCKET,
          prefix: archive.prefix,
          manifestSha256: session.manifestSha256,
        };
        await updateManifest(configPath, (manifest) => {
          manifest.offboarded.archive = session.recorded;
        });
      },
    ),
  ];
}

// Every media object into one ZIP, streamed object by object.
async function archiveUploads(providers, archive) {
  const media = await providers.r2(providers.ops.media.bucket);
  const objects = await media.list();
  const zip = zipStream(
    objects.map((object) => ({
      name: object.key,
      modified: object.lastModified,
      open: async () => (await media.get(object.key)).body ?? [],
    })),
  );
  const bucket = await providers.r2(ARCHIVE_BUCKET);
  const stored = await bucket.upload(`${archive.prefix}uploads.zip`, zip, "application/zip");
  return { path: "uploads.zip", ...stored, entries: objects.length };
}

// What manifest.json records: each file, and where everything came from.
function manifestOf(site, files, date) {
  const { ops, archive, ploi, frontend, ci } = site;
  return {
    project: ops.project,
    archivedAt: date.toISOString(),
    gq: VERSION,
    bucket: ARCHIVE_BUCKET,
    prefix: archive.prefix,
    files,
    sources: {
      media: { bucket: ops.media.bucket, domain: ops.media.domain },
      backups: { bucket: ops.backups.bucket, prefix: archive.backupsPrefix },
      releases: { bucket: ops.releases.bucket },
      ciBackups: { bucket: ops.ci.backupBucket },
      ploi: {
        serverId: ops.ploi.serverId,
        siteId: ops.ploi.siteId ?? null,
        domain: ops.domains.admin,
        database: { name: ops.ploi.database, id: ploi.database?.id ?? null },
        systemUser: { name: ops.ploi.systemUser, id: ploi.systemUser?.id ?? null },
      },
      frontend: {
        worker: frontend.worker,
        domain: ops.domains.frontend,
        d1: frontend.d1 ? { name: frontend.d1.name, id: frontend.d1.uuid } : null,
      },
      ci: {
        worker: ci.worker,
        workflows: ci.workflows,
        containerApplication: ci.container?.name ?? null,
      },
      artifacts: { namespace: ops.artifacts.namespace, repo: ops.artifacts.repo },
      github: { repository: ops.github.repository, head: archive.head },
      cloudflare: {
        accountId: ops.cloudflare.accountId,
        zoneId: ops.cloudflare.zoneId,
        zoneName: ops.cloudflare.zoneName ?? null,
      },
      sigillo: { projectId: ops.sigillo?.projectId ?? null },
    },
  };
}

// Reads every archived file back and compares it with what was written;
// throws, naming each difference, before anything is deleted.
async function verifyArchive(providers, prefix, session) {
  const bucket = await providers.r2(ARCHIVE_BUCKET);
  const problems = [];
  for (const file of session.manifest.files) {
    const read = await readBack(bucket, `${prefix}${file.path}`, {
      tail: file.path === "uploads.zip",
    });
    if (!read) {
      problems.push(`${file.path} can't be read back`);
      continue;
    }
    if (read.size !== file.size)
      problems.push(`${file.path} is ${read.size} bytes, not ${file.size}`);
    else if (read.sha256 !== file.sha256) problems.push(`${file.path}'s sha256 differs`);
    if (file.entries !== undefined) {
      const entries = zipEntryCount(read.tail);
      const objects = (await (await providers.r2(providers.ops.media.bucket)).list()).length;
      if (entries !== objects) {
        problems.push(
          `uploads.zip holds ${entries ?? "no readable"} entries, but ${providers.ops.media.bucket} has ${objects} objects`,
        );
      }
    }
  }
  const manifest = await readBack(bucket, `${prefix}manifest.json`);
  if (manifest?.sha256 !== session.manifestSha256) problems.push("manifest.json differs");
  if (problems.length > 0) {
    throw new Error(
      `The archive at r2://${ARCHIVE_BUCKET}/${prefix} failed verification: ${problems.join("; ")}. Nothing was deleted; run gq offboard --archive again to archive it anew.`,
    );
  }
}

// An object's size and sha256 (and its last bytes, with `tail`), streamed;
// null when it can't be read.
async function readBack(bucket, key, { tail = false } = {}) {
  let response;
  try {
    response = await bucket.get(key);
  } catch {
    return null;
  }
  const hash = createHash("sha256");
  let size = 0;
  let last = Buffer.alloc(0);
  for await (const chunk of response.body ?? []) {
    hash.update(chunk);
    size += chunk.length;
    if (tail) last = Buffer.concat([last, chunk]).subarray(-ZIP_TAIL_BYTES);
  }
  return { size, sha256: hash.digest("hex"), tail: last };
}

// The live infrastructure, deleted in gq-smoke-down's order once the archive
// is recorded: Ploi, the Workers and their D1 store, Workflows and
// containers, the buckets (emptied with keys scoped to each), Artifacts, the
// Site's own DNS records, the project's tokens, then GitHub.
function deletionItems(site, { configPath }) {
  const { ops, ploi, frontend, ci } = site;
  return [
    ploi.site
      ? todo(
          "Ploi",
          `delete the site ${ploi.site.domain ?? ops.domains.admin} (${ops.ploi.siteId}) and forget ploi.siteId in gq.ops.json`,
          async (p) => {
            await p.ploi.deleteSite();
            await forgetSiteId(configPath);
          },
        )
      : ops.ploi.siteId
        ? todo("Ploi", `forget ploi.siteId in gq.ops.json (the site is deleted)`, () =>
            forgetSiteId(configPath),
          )
        : done("Ploi", `the site ${ops.domains.admin} is deleted`),
    ploi.database
      ? todo("Ploi", `delete the database ${ploi.database.name} (${ploi.database.id})`, (p) =>
          p.ploi.deleteDatabase(ploi.database.id),
        )
      : done("Ploi", `the database ${ops.ploi.database} is deleted`),
    ploi.systemUser
      ? todo(
          "Ploi",
          `delete the system user ${ploi.systemUser.name} (${ploi.systemUser.id})`,
          (p) => p.ploi.deleteSystemUser(ploi.systemUser.id),
        )
      : done("Ploi", `the system user ${ops.ploi.systemUser} is deleted`),
    frontend.exists
      ? todo("Frontend", `delete the Worker ${frontend.worker}`, (p) =>
          p.cloudflare.deleteWorker(frontend.worker),
        )
      : done("Frontend", `the Worker ${frontend.worker} is deleted`),
    frontend.d1
      ? todo("Frontend", `delete the D1 store ${frontend.d1.name} (${frontend.d1.uuid})`, (p) =>
          p.cloudflare.deleteD1(frontend.d1.uuid),
        )
      : done("Frontend", `the D1 store ${frontend.d1Name} is deleted`),
    ci.exists
      ? todo("CI", `delete the Worker ${ci.worker}`, (p) => p.cloudflare.deleteWorker(ci.worker))
      : done("CI", `the Worker ${ci.worker} is deleted`),
    ...(ci.workflows.length > 0
      ? ci.workflows.map((name) =>
          todo("CI", `delete the Workflow ${name}`, (p) => p.cloudflare.deleteWorkflow(name)),
        )
      : [done("CI", "its Workflows are deleted")]),
    ci.container
      ? todo(
          "CI",
          `delete the container application ${ci.container.name} (${ci.container.id})`,
          (p) => p.cloudflare.deleteContainerApplication(ci.container.id),
        )
      : done("CI", "no container application is left"),
    site.mediaDomain
      ? todo(
          "Media",
          `remove the custom domain ${ops.media.domain} from ${ops.media.bucket}`,
          (p) => p.cloudflare.removeBucketDomain(ops.media.bucket, ops.media.domain),
        )
      : done("Media", `the custom domain ${ops.media.domain} is removed`),
    ...site.buckets.map(({ name, exists }) =>
      exists
        ? todo("R2", `empty ${name} (with a key scoped to it) and delete it`, async (p) => {
            await emptyBucket(await p.r2(name));
            await p.cloudflare.deleteBucket(name);
          })
        : done("R2", `the bucket ${name} is deleted`),
    ),
    site.artifacts
      ? todo(
          "Artifacts",
          `delete the repository ${ops.artifacts.namespace}/${ops.artifacts.repo}`,
          (p) =>
            p.cloudflare.deleteArtifactsRepository(ops.artifacts.namespace, ops.artifacts.repo),
        )
      : done(
          "Artifacts",
          `the repository ${ops.artifacts.namespace}/${ops.artifacts.repo} is deleted`,
        ),
    manual(
      "Artifacts",
      `the empty namespace ${ops.artifacts.namespace} stays; delete it in the dashboard if it should go`,
    ),
    // The zone is shared (other Sites' hosts live in it): only records named
    // exactly as this Site's hosts go.
    ...site.records.map((record) =>
      todo("DNS", `delete ${record.type} ${record.name} → ${record.content}`, (p) =>
        p.cloudflare.deleteDnsRecord(record.id),
      ),
    ),
    done(
      "DNS",
      `the zone ${ops.cloudflare.zoneName ?? ops.cloudflare.zoneId} and every other record in it stay`,
    ),
    // Last on Cloudflare: phase 1 only disabled them.
    ...(site.tokens.length > 0
      ? site.tokens.map((token) =>
          todo("Tokens", `delete ${token.name}`, (p) => p.cloudflare.deleteToken(token)),
        )
      : [done("Tokens", `no GETQUICK ${ops.project.toUpperCase()} token is left`)]),
    ci.hook
      ? todo("GitHub", `delete the push webhook ${ci.hook.id} on ${ops.github.repository}`, (p) =>
          p.github.deleteHook(ci.hook.id),
        )
      : done("GitHub", "no push webhook to the CI Worker is left"),
    site.repositoryArchived
      ? done("GitHub", `the repository ${ops.github.repository} is archived`)
      : todo("GitHub", `archive the repository ${ops.github.repository} (it stays readable)`, (p) =>
          p.github.archive(),
        ),
  ];
}

function forgetSiteId(configPath) {
  return updateManifest(configPath, (manifest) => {
    delete manifest.ploi.siteId;
  });
}

// Deletes every object `bucket` (a key scoped to it) can list.
async function emptyBucket(bucket) {
  const objects = await bucket.list();
  for (let index = 0; index < objects.length; index += DELETE_CONCURRENCY) {
    await Promise.all(
      objects.slice(index, index + DELETE_CONCURRENCY).map(({ key }) => bucket.delete(key)),
    );
  }
}
