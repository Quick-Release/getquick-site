// The blueprint's managed files in one site. blueprint/ownership.json, which
// ships with the package, lists every path the blueprint touches by category;
// anything it doesn't list is site-owned and never read or written here.
// gq.lock.json, committed at the site root, records the gq version, the
// schema version and the hash of each managed file as gq last wrote it, so a
// file whose hash no longer matches is a local edit rather than an old
// template. Today only fully generated files are rendered.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import ownership from "../../blueprint/ownership.json" with { type: "json" };
import { VERSION } from "../version.mjs";

export const LOCK_FILENAME = "gq.lock.json";

const BLUEPRINT = new URL("../../blueprint/", import.meta.url);

// What gq sync would do in `root` for the validated `manifest`: each managed
// file's `status` (`unchanged`, `create`, `update`, or `edited` when the site
// changed it since gq last wrote it), its `current` and rendered `content`,
// and the lock to record (`lock.status` `unchanged`, `create` or `update`).
export async function planManagedFiles(root, manifest) {
  const lock = await readLock(root);
  const files = [];
  for (const { path, content } of await renderManagedFiles()) {
    const current = await readOptional(join(root, path));
    let status;
    if (current?.equals(content)) status = "unchanged";
    else if (current === undefined) status = "create";
    else if (lock?.files[path] === hash(current)) status = "update";
    else status = "edited";
    files.push({ path, status, current, content });
  }

  const hashes = Object.fromEntries(
    files.map(({ path, content }) => [path, hash(content)]).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const content = `${JSON.stringify(
    { gq: VERSION, schemaVersion: manifest.schemaVersion, files: hashes },
    null,
    2,
  )}\n`;
  const status = lock === undefined ? "create" : lock.text === content ? "unchanged" : "update";
  return { files, lock: { path: LOCK_FILENAME, status, content } };
}

// Writes what `plan` creates or updates, the lock last. Refuses a plan with
// an edited file: nothing is written then.
export async function applyManagedFiles(root, plan) {
  if (plan.files.some(({ status }) => status === "edited")) {
    throw new Error("Refusing to write managed files over local edits.");
  }
  for (const { path, status, content } of [...plan.files, plan.lock]) {
    if (status === "unchanged") continue;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

async function renderManagedFiles() {
  return Promise.all(
    ownership.fullyGenerated.map(async ({ path, template }) => ({
      path,
      content: await readFile(new URL(template, BLUEPRINT)),
    })),
  );
}

async function readLock(root) {
  const buffer = await readOptional(join(root, LOCK_FILENAME));
  if (buffer === undefined) return undefined;
  const text = buffer.toString("utf8");
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (error) {
    throw new Error(`${LOCK_FILENAME} is not valid JSON: ${error.message}`, { cause: error });
  }
  const files = lock?.files;
  if (
    !files ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    !Object.values(files).every((value) => typeof value === "string")
  ) {
    throw new Error(`${LOCK_FILENAME} must map each managed path to its hash under "files".`);
  }
  // An older gq would take a newer one's files for old templates and
  // downgrade them.
  if (typeof lock.gq === "string" && isNewerVersion(lock.gq, VERSION)) {
    throw new Error(
      `${LOCK_FILENAME} was written by gq ${lock.gq}, newer than the installed ${VERSION}. ` +
        "Update @getquick/site.",
    );
  }
  return { text, files };
}

// Compares the numeric major.minor.patch of two versions.
function isNewerVersion(version, than) {
  const parts = (value) => value.split(/[.+-]/u, 3).map(Number);
  const [a, b] = [parts(version), parts(than)];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

function hash(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
