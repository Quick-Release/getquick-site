// The blueprint's managed files in one site. blueprint/ownership.json, which
// ships with the package, lists every path the blueprint touches by category;
// anything it doesn't list is site-owned and never read or written here.
// gq.lock.json, committed at the site root, records the gq version, the
// schema version and the hash of each managed file as gq last wrote it, so a
// file whose hash no longer matches is a local edit rather than an old
// template. Today only fully generated files are rendered: regular files,
// executable or not, and symlinks (whose target is what gets hashed).
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import ownership from "../../blueprint/ownership.json" with { type: "json" };
import { VERSION } from "../version.mjs";

export const LOCK_FILENAME = "gq.lock.json";

const BLUEPRINT = new URL("../../blueprint/", import.meta.url);

// What gq sync would do in `root` for the validated `manifest`: each managed
// file's `status` (`unchanged`, `create`, `update`, or `edited` when the site
// changed it since gq last wrote it), its `current` and rendered `content`
// (for a symlink, its target as a line of text, so either can be diffed), and
// the lock to record (`lock.status` `unchanged`, `create` or `update`).
export async function planManagedFiles(root, manifest) {
  const lock = await readLock(root);
  const files = [];
  for (const rendered of await renderManagedFiles()) {
    const current = await readEntry(join(root, rendered.path));
    const written = lock?.files[rendered.path];
    const [currentHash, renderedHash] = [hashEntry(current), hashEntry(rendered)];
    let status;
    if (current === undefined) status = "create";
    else if (sameEntry(current, rendered)) status = "unchanged";
    // Unedited since gq wrote it, or differing from the template only in mode.
    else if (currentHash !== undefined && [written, renderedHash].includes(currentHash)) {
      status = "update";
    } else status = "edited";
    files.push({
      ...rendered,
      status,
      current: current && displayEntry(current),
      content: displayEntry(rendered),
      hash: renderedHash,
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));

  const hashes = Object.fromEntries(files.map(({ path, hash }) => [path, hash]));
  const content = `${JSON.stringify(
    { gq: VERSION, schemaVersion: manifest.schemaVersion, files: hashes },
    null,
    2,
  )}\n`;
  const status = lock === undefined ? "create" : lock.text === content ? "unchanged" : "update";
  return { files, lock: { path: LOCK_FILENAME, status, content } };
}

// Writes what `plan` creates or updates, the lock last. Refuses a plan with
// an edited file: nothing is written then. What a file or symlink replaces is
// removed first, so a write never goes through a symlink the site left there.
export async function applyManagedFiles(root, plan) {
  if (plan.files.some(({ status }) => status === "edited")) {
    throw new Error("Refusing to write managed files over local edits.");
  }
  for (const file of [...plan.files, plan.lock]) {
    if (file.status === "unchanged") continue;
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await rm(path, { force: true });
    if (file.symlink !== undefined) await symlink(file.symlink, path);
    else {
      await writeFile(path, file.content);
      if (file.executable) await chmod(path, 0o755);
    }
  }
}

// Each managed entry as the blueprint renders it: `{ path, symlink }` for a
// symlink, else `{ path, bytes, executable }`.
async function renderManagedFiles() {
  return Promise.all(
    ownership.fullyGenerated.map(async ({ path, template, symlink, executable = false }) =>
      symlink === undefined
        ? { path, bytes: await readFile(new URL(template, BLUEPRINT)), executable }
        : { path, symlink },
    ),
  );
}

// What is at `path`, not following a symlink: undefined when nothing is,
// `{ symlink }`, `{ bytes, executable }`, or `{ other }` naming what else
// (such as a directory) stands where a file or symlink belongs.
async function readEntry(path) {
  const stats = await unlessMissing(lstat(path));
  if (stats === undefined) return undefined;
  if (stats.isSymbolicLink()) return { symlink: await readlink(path) };
  if (stats.isFile()) {
    return { bytes: await readFile(path), executable: (stats.mode & 0o111) !== 0 };
  }
  return { other: stats.isDirectory() ? "directory" : "special file" };
}

function sameEntry(current, rendered) {
  if (rendered.symlink !== undefined) return current.symlink === rendered.symlink;
  return (
    current.bytes?.equals(rendered.bytes) === true && current.executable === rendered.executable
  );
}

// A file's hash covers its bytes only, so a lost executable bit is restored
// rather than taken for a local edit; a symlink's covers its target, marked
// so a regular file holding the same text doesn't match it. Anything else
// has no hash, so it never matches the lock.
function hashEntry(entry) {
  if (entry === undefined) return undefined;
  if (entry.symlink !== undefined) return hash(`symlink\0${entry.symlink}`);
  if (entry.bytes !== undefined) return hash(entry.bytes);
  return undefined;
}

function displayEntry(entry) {
  if (entry.symlink !== undefined) return Buffer.from(`symlink -> ${entry.symlink}\n`);
  if (entry.bytes !== undefined) return entry.bytes;
  return Buffer.from(`${entry.other}\n`);
}

async function readLock(root) {
  const buffer = await unlessMissing(readFile(join(root, LOCK_FILENAME)));
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

// What `operation` resolves to, or undefined when the path it reads is missing.
async function unlessMissing(operation) {
  try {
    return await operation;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
