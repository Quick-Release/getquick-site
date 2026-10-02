import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { requestJson } from "../ops/http.mjs";

export const SKILLS_USAGE = ["gq skills update [--check]"];

const REGISTRATION_FILENAME = ".agents/skills.json";
const LOCK_FILENAME = "skills-lock.json";
const SKILLS_DIRECTORY = ".agents/skills";
const SCHEMA_VERSION = 1;

const MAX_SKILL_FILES = 500;
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const MAX_SKILL_TOTAL_BYTES = 5 * 1024 * 1024;
const WRITE_LOCK_DIRECTORY = ".gq-skills-update.lock";

const RESERVED_SKILL_KEYS = new Set([".backup", "__proto__", "constructor"]);

export function isSkillsCommand(argv) {
  return argv[0] === "skills";
}

// Resolves to an exit code.
export async function runSkillsCommand(argv, { cwd, env, fetch, io }) {
  const options = parseSkillsArguments(argv);
  const testHooks = parseTestHooks(env);
  const root = await findGitRoot(cwd);
  if (!root) {
    throw new Error(`No Git repository found from ${resolve(cwd)}. Run inside a repository.`);
  }

  const run = async () => {
    await assertSafeFilesystemAnchors(root);

    const registrations = await readRegistrations(root);
    const lock = await readLock(root);
    const token = env.GITHUB_TOKEN || env.GH_TOKEN;
    const cache = createGithubCache();

    const plans = [];
    for (const name of Object.keys(registrations.skills).sort()) {
      const source = registrations.skills[name];
      const lockEntry = lock.skills[name];
      const skillPath = join(root, SKILLS_DIRECTORY, name);
      const local = await readLocalSkill(skillPath, name);

      if (lockEntry) assertSkillDriftFree(name, local, lockEntry);

      const fetched = await fetchUpstreamSkill(source, { fetch, token, cache });
      const desired = toLockEntry(source, fetched);
      plans.push(planSkill(name, { lockEntry, local, desired }));
    }

    await recheckForConcurrentEdits(root, plans);

    const pending = plans.filter(({ lockChanged }) => lockChanged);

    if (options.check) {
      if (pending.length === 0) {
        io.out("Skills: up to date.");
        return 0;
      }
      for (const plan of pending) io.out(checkMessage(plan));
      return 1;
    }

    if (pending.length === 0) {
      io.out("Skills: up to date.");
      return 0;
    }

    const nextSkills = cloneRecord(lock.skills);
    for (const plan of plans) nextSkills[plan.name] = plan.desired;
    const lockContent = `${JSON.stringify(sortedLock({ skills: nextSkills }), null, 2)}\n`;

    await applyTransaction(
      root,
      {
        updates: plans.filter(({ fileAction }) => fileAction !== "none"),
        lockContent,
      },
      testHooks,
    );

    for (const plan of pending) io.out(updateMessage(plan));
    io.out(`${LOCK_FILENAME}: updated.`);
    return 0;
  };

  if (options.check) return run();

  const writeLock = await acquireWriteLock(root);
  try {
    return await run();
  } finally {
    await releaseWriteLock(writeLock);
  }
}

function parseSkillsArguments(argv) {
  if (argv[0] !== "skills" || argv[1] !== "update") throw new Error(`Usage: ${SKILLS_USAGE[0]}`);
  const options = { check: false };
  for (const argument of argv.slice(2)) {
    if (argument === "--check" && !options.check) options.check = true;
    else throw new Error(`Usage: ${SKILLS_USAGE[0]}`);
  }
  return options;
}

function parseTestHooks(env) {
  const failAfterBackup = env.GQ_TEST_SKILLS_FAIL_AFTER_BACKUP;
  const failAfterLock = env.GQ_TEST_SKILLS_FAIL_AFTER_LOCK === "1";
  return {
    failAfterBackup:
      typeof failAfterBackup === "string" && failAfterBackup.trim() !== ""
        ? failAfterBackup.trim()
        : undefined,
    failAfterLock,
  };
}

async function recheckForConcurrentEdits(root, plans) {
  for (const plan of plans) {
    const skillPath = join(root, SKILLS_DIRECTORY, plan.name);
    const local = await readLocalSkill(skillPath, plan.name);

    if (plan.current) {
      assertSkillDriftFree(plan.name, local, plan.current);
      continue;
    }

    if (plan.bootstrap) {
      assertBootstrapMatch(plan.name, local, plan.desired);
      continue;
    }

    if (plan.fileAction === "install" && local) {
      throw new Error(
        `${SKILLS_DIRECTORY}/${plan.name}: appeared on disk while updating. ` +
          `Refusing to overwrite files created during update.`,
      );
    }
  }
}

async function findGitRoot(startDirectory) {
  let directory = await realpath(resolve(startDirectory));
  while (true) {
    if (await exists(join(directory, ".git"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function acquireWriteLock(root) {
  const path = join(root, WRITE_LOCK_DIRECTORY);
  try {
    await mkdir(path);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    throw new Error(
      `Another gq skills update is already running (lock: ${WRITE_LOCK_DIRECTORY}). ` +
        "Wait for it to finish, or remove that lock directory if no updater is running.",
      { cause: error },
    );
  }

  try {
    const owner = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    await writeFile(join(path, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }

  return { path };
}

async function releaseWriteLock(lock) {
  try {
    await rm(lock.path, { recursive: true });
  } catch (error) {
    throw new Error(
      `Skills update finished but failed to release lock ${WRITE_LOCK_DIRECTORY}: ${error.message}`,
      { cause: error },
    );
  }
}

async function assertSafeFilesystemAnchors(root) {
  await assertExistingDirectorySafe(join(root, ".agents"), ".agents");
  await assertExistingDirectorySafe(join(root, SKILLS_DIRECTORY), SKILLS_DIRECTORY);
  await assertExistingFileSafe(join(root, REGISTRATION_FILENAME), REGISTRATION_FILENAME);
  await assertExistingFileSafe(join(root, LOCK_FILENAME), LOCK_FILENAME);
}

async function assertExistingDirectorySafe(path, label) {
  const entry = await statOrUndefined(path);
  if (!entry) return;
  if (entry.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
  if (!entry.isDirectory()) throw new Error(`${label} must be a directory.`);
}

async function assertExistingFileSafe(path, label) {
  const entry = await statOrUndefined(path);
  if (!entry) return;
  if (entry.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
  if (!entry.isFile()) throw new Error(`${label} must be a regular file.`);
}

async function readRegistrations(root) {
  const path = join(root, REGISTRATION_FILENAME);
  const text = await readText(path, `${REGISTRATION_FILENAME} is required`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${REGISTRATION_FILENAME} is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${REGISTRATION_FILENAME} must be a JSON object.`);
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `${REGISTRATION_FILENAME} schemaVersion must be ${SCHEMA_VERSION}; got ${JSON.stringify(parsed.schemaVersion)}.`,
    );
  }
  if (!isPlainObject(parsed.skills)) {
    throw new Error(`${REGISTRATION_FILENAME} skills must be an object keyed by local skill name.`);
  }

  const skills = createRecord();
  for (const [name, entry] of Object.entries(parsed.skills)) {
    validateSkillName(name, `${REGISTRATION_FILENAME} skills.${name}`);
    if (!isPlainObject(entry)) {
      throw new Error(`${REGISTRATION_FILENAME} skills.${name} must be an object.`);
    }
    const repository = expectTrimmedString(
      entry.repository,
      `${REGISTRATION_FILENAME} skills.${name}.repository`,
    );
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
      throw new Error(
        `${REGISTRATION_FILENAME} skills.${name}.repository must be owner/repo (GitHub).`,
      );
    }
    const sourcePath = parseRelativePath(
      entry.path,
      `${REGISTRATION_FILENAME} skills.${name}.path`,
    );
    const ref = expectTrimmedString(entry.ref, `${REGISTRATION_FILENAME} skills.${name}.ref`);
    const trackingBranch =
      entry.trackingBranch === undefined
        ? ref
        : expectTrimmedString(
            entry.trackingBranch,
            `${REGISTRATION_FILENAME} skills.${name}.trackingBranch`,
          );
    setUnique(skills, name, `${REGISTRATION_FILENAME} skills`);
    skills[name] = {
      repository,
      path: sourcePath,
      ref,
      trackingBranch,
    };
  }
  return { skills };
}

async function readLock(root) {
  const path = join(root, LOCK_FILENAME);
  const text = await readOptionalText(path);
  if (text === undefined) return { schemaVersion: SCHEMA_VERSION, skills: createRecord() };

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${LOCK_FILENAME} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!isPlainObject(parsed)) throw new Error(`${LOCK_FILENAME} must be a JSON object.`);
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `${LOCK_FILENAME} schemaVersion must be ${SCHEMA_VERSION}; got ${JSON.stringify(parsed.schemaVersion)}.`,
    );
  }
  if (!isPlainObject(parsed.skills)) throw new Error(`${LOCK_FILENAME} skills must be an object.`);

  const skills = createRecord();
  for (const [name, entry] of Object.entries(parsed.skills)) {
    validateSkillName(name, `${LOCK_FILENAME} skills.${name}`);
    if (!isPlainObject(entry))
      throw new Error(`${LOCK_FILENAME} skills.${name} must be an object.`);
    if (!isPlainObject(entry.source)) {
      throw new Error(`${LOCK_FILENAME} skills.${name}.source must be an object.`);
    }
    const source = {
      repository: expectTrimmedString(
        entry.source.repository,
        `${LOCK_FILENAME} skills.${name}.source.repository`,
      ),
      path: parseRelativePath(entry.source.path, `${LOCK_FILENAME} skills.${name}.source.path`),
      ref: expectTrimmedString(entry.source.ref, `${LOCK_FILENAME} skills.${name}.source.ref`),
      trackingBranch: expectTrimmedString(
        entry.source.trackingBranch,
        `${LOCK_FILENAME} skills.${name}.source.trackingBranch`,
      ),
    };
    const installedCommit = expectTrimmedString(
      entry.installedCommit,
      `${LOCK_FILENAME} skills.${name}.installedCommit`,
    );
    if (!isPlainObject(entry.files)) {
      throw new Error(`${LOCK_FILENAME} skills.${name}.files must be an object.`);
    }
    const files = createRecord();
    for (const [filePath, details] of Object.entries(entry.files)) {
      const canonicalPath = parseRelativePath(
        filePath,
        `${LOCK_FILENAME} skills.${name}.files.${filePath}`,
      );
      if (!isPlainObject(details)) {
        throw new Error(`${LOCK_FILENAME} skills.${name}.files.${filePath} must be an object.`);
      }
      const sha256 = expectTrimmedString(
        details.sha256,
        `${LOCK_FILENAME} skills.${name}.files.${filePath}.sha256`,
      );
      if (!/^[A-Fa-f0-9]{64}$/u.test(sha256)) {
        throw new Error(
          `${LOCK_FILENAME} skills.${name}.files.${filePath}.sha256 must be hex SHA-256.`,
        );
      }
      const mode = expectTrimmedString(
        details.mode,
        `${LOCK_FILENAME} skills.${name}.files.${filePath}.mode`,
      );
      if (mode !== "100644" && mode !== "100755") {
        throw new Error(
          `${LOCK_FILENAME} skills.${name}.files.${filePath}.mode must be 100644 or 100755.`,
        );
      }
      setUnique(files, canonicalPath, `${LOCK_FILENAME} skills.${name}.files`);
      files[canonicalPath] = { sha256: sha256.toLowerCase(), mode };
    }

    setUnique(skills, name, `${LOCK_FILENAME} skills`);
    skills[name] = { source, installedCommit, files };
  }

  return { schemaVersion: SCHEMA_VERSION, skills };
}

function planSkill(name, { lockEntry, local, desired }) {
  if (lockEntry) {
    const lockChanged = !sameEntry(lockEntry, desired);
    return {
      name,
      current: lockEntry,
      desired,
      fileAction: lockChanged ? "replace" : "none",
      lockChanged,
      bootstrap: false,
    };
  }

  if (!local) {
    return {
      name,
      current: undefined,
      desired,
      fileAction: "install",
      lockChanged: true,
      bootstrap: false,
    };
  }

  assertBootstrapMatch(name, local, desired);

  return {
    name,
    current: undefined,
    desired,
    fileAction: "none",
    lockChanged: true,
    bootstrap: true,
  };
}

function assertBootstrapMatch(name, local, desired) {
  if (!local) {
    throw new Error(`${SKILLS_DIRECTORY}/${name}: missing while bootstrapping skill state.`);
  }

  const drift = diffFiles(desired.files, local.files);
  if (drift.length > 0) {
    throw new Error(
      `${SKILLS_DIRECTORY}/${name}: exists without ${LOCK_FILENAME} and differs from ` +
        `registered upstream (${drift.slice(0, 3).join(", ")}${drift.length > 3 ? ", …" : ""}). ` +
        `Refusing to overwrite local files; align it to upstream first or remove ${SKILLS_DIRECTORY}/${name}.`,
    );
  }
}

function checkMessage(plan) {
  if (plan.fileAction === "replace") {
    return (
      `${SKILLS_DIRECTORY}/${plan.name}: update available ${shortSha(plan.current.installedCommit)} ` +
      `→ ${shortSha(plan.desired.installedCommit)}.`
    );
  }
  if (plan.fileAction === "install") {
    return `${SKILLS_DIRECTORY}/${plan.name}: not installed; would install ${shortSha(plan.desired.installedCommit)}.`;
  }
  if (plan.bootstrap) {
    return (
      `${SKILLS_DIRECTORY}/${plan.name}: existing copy matches upstream ${shortSha(plan.desired.installedCommit)}; ` +
      `would record it in ${LOCK_FILENAME}.`
    );
  }
  return `${SKILLS_DIRECTORY}/${plan.name}: lock metadata changed; would update ${LOCK_FILENAME}.`;
}

function updateMessage(plan) {
  if (plan.fileAction === "replace") {
    return (
      `${SKILLS_DIRECTORY}/${plan.name}: updated ${shortSha(plan.current.installedCommit)} ` +
      `→ ${shortSha(plan.desired.installedCommit)}.`
    );
  }
  if (plan.fileAction === "install") {
    return `${SKILLS_DIRECTORY}/${plan.name}: installed ${shortSha(plan.desired.installedCommit)}.`;
  }
  if (plan.bootstrap) {
    return `${SKILLS_DIRECTORY}/${plan.name}: recorded existing upstream copy ${shortSha(plan.desired.installedCommit)}.`;
  }
  return `${SKILLS_DIRECTORY}/${plan.name}: updated lock metadata.`;
}

function assertSkillDriftFree(name, local, lockEntry) {
  if (!local) {
    throw new Error(
      `${SKILLS_DIRECTORY}/${name}: missing from disk but tracked in ${LOCK_FILENAME}. ` +
        "Restore it from Git before updating.",
    );
  }

  const drift = diffFiles(lockEntry.files, local.files);
  if (drift.length === 0) return;

  throw new Error(
    `${SKILLS_DIRECTORY}/${name}: local drift detected (${drift.slice(0, 3).join(", ")}${
      drift.length > 3 ? ", …" : ""
    }). Refusing to overwrite local changes.`,
  );
}

async function readLocalSkill(path, name) {
  const stats = await statOrUndefined(path);
  if (!stats) return undefined;

  if (stats.isSymbolicLink()) {
    throw new Error(`${SKILLS_DIRECTORY}/${name}: symlinks are not supported.`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${SKILLS_DIRECTORY}/${name}: expected a directory.`);
  }

  const files = createRecord();
  await walkDirectory(path, "", files, name);
  return { files };
}

async function walkDirectory(root, prefix, files, name) {
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));

  for (const entry of entries) {
    const absolute = join(root, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isSymbolicLink()) {
      throw new Error(`${SKILLS_DIRECTORY}/${name}/${relativePath}: symlinks are not supported.`);
    }
    if (entry.isDirectory()) {
      await walkDirectory(absolute, relativePath, files, name);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `${SKILLS_DIRECTORY}/${name}/${relativePath}: only regular files are supported in managed skills.`,
      );
    }

    const pathKey = parseRelativePath(relativePath, `${SKILLS_DIRECTORY}/${name}/${relativePath}`);
    setUnique(files, pathKey, `${SKILLS_DIRECTORY}/${name}`);

    const bytes = await readFile(absolute);
    const mode = (await lstat(absolute)).mode & 0o111 ? "100755" : "100644";
    files[pathKey] = { sha256: sha256(bytes), mode };
  }
}

function diffFiles(expected, current) {
  const changes = [];
  const expectedPaths = new Set(Object.keys(expected));
  const currentPaths = new Set(Object.keys(current));

  for (const path of [...expectedPaths].sort()) {
    if (!currentPaths.has(path)) {
      changes.push(`missing ${path}`);
      continue;
    }
    const expectedFile = expected[path];
    const currentFile = current[path];
    if (expectedFile.sha256 !== currentFile.sha256 || expectedFile.mode !== currentFile.mode) {
      changes.push(`changed ${path}`);
    }
  }

  for (const path of [...currentPaths].sort()) {
    if (!expectedPaths.has(path)) changes.push(`extra ${path}`);
  }

  return changes;
}

function createGithubCache() {
  return {
    commits: new Map(),
    trees: new Map(),
    blobs: new Map(),
  };
}

async function fetchUpstreamSkill(source, { fetch, token, cache }) {
  const repository = encodeRepository(source.repository);
  const commitSha = await fetchCommitSha(source, { repository, fetch, token, cache });
  const tree = await fetchTree(source, { repository, commitSha, fetch, token, cache });

  if (!Array.isArray(tree.tree)) {
    throw new Error(`GitHub tree for ${source.repository}@${source.ref} has no tree entries.`);
  }
  if (tree.truncated) {
    throw new Error(
      `GitHub tree for ${source.repository}@${source.ref} is truncated by the GitHub API ` +
        "(whole-repository listing); use a smaller upstream repository or another source ref.",
    );
  }

  const entries = collectSkillTreeEntries(source, tree.tree);
  if (entries.length > MAX_SKILL_FILES) {
    throw new Error(
      `${source.repository}:${source.path} has ${entries.length} files; limit is ${MAX_SKILL_FILES}.`,
    );
  }

  const files = createRecord();
  let totalBytes = 0;
  for (const { relativePath, blobSha, mode } of entries) {
    const blob = await fetchBlob(source, { repository, blobSha, fetch, token, cache });
    if (blob.encoding !== "base64" || typeof blob.content !== "string") {
      throw new Error(
        `${source.repository}:${source.path}/${relativePath} must be a base64 blob from GitHub.`,
      );
    }

    const declaredSize = parseBlobSize(
      blob.size,
      `${source.repository}:${source.path}/${relativePath}`,
    );
    if (declaredSize > MAX_SKILL_FILE_BYTES) {
      throw new Error(
        `${source.repository}:${source.path}/${relativePath} is ${declaredSize} bytes; ` +
          `per-file limit is ${MAX_SKILL_FILE_BYTES}.`,
      );
    }
    totalBytes += declaredSize;
    if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
      throw new Error(
        `${source.repository}:${source.path} exceeds ${MAX_SKILL_TOTAL_BYTES} bytes; narrow the imported path.`,
      );
    }

    const encoded = blob.content.replaceAll(/\s+/gu, "");
    if (encoded.length > encodedLengthForBytes(MAX_SKILL_FILE_BYTES)) {
      throw new Error(
        `${source.repository}:${source.path}/${relativePath} encoded payload is too large ` +
          `(length ${encoded.length}).`,
      );
    }

    const expectedEncodedLength = encodedLengthForBytes(declaredSize);
    if (encoded.length !== expectedEncodedLength) {
      throw new Error(
        `${source.repository}:${source.path}/${relativePath} encoded payload length ${encoded.length} ` +
          `does not match declared size ${declaredSize}.`,
      );
    }

    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== declaredSize) {
      throw new Error(
        `${source.repository}:${source.path}/${relativePath} decoded size ${bytes.length} ` +
          `does not match declared size ${declaredSize}.`,
      );
    }

    setUnique(files, relativePath, `${source.repository}:${source.path}`);
    files[relativePath] = { bytes, mode };
  }

  return { commitSha, files };
}

async function fetchCommitSha(source, { repository, fetch, token, cache }) {
  const key = `${source.repository}\n${source.ref}`;
  const commit = await cached(cache.commits, key, async () =>
    githubJson(`/repos/${repository}/commits/${encodeURIComponent(source.ref)}`, { fetch, token }),
  );
  return expectTrimmedString(commit.sha, `${source.repository}@${source.ref} commit sha`);
}

async function fetchTree(source, { repository, commitSha, fetch, token, cache }) {
  const key = `${source.repository}\n${commitSha}`;
  return cached(cache.trees, key, async () =>
    githubJson(`/repos/${repository}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`, {
      fetch,
      token,
    }),
  );
}

async function fetchBlob(source, { repository, blobSha, fetch, token, cache }) {
  const key = `${source.repository}\n${blobSha}`;
  return cached(cache.blobs, key, async () =>
    githubJson(`/repos/${repository}/git/blobs/${encodeURIComponent(blobSha)}`, { fetch, token }),
  );
}

async function cached(map, key, load) {
  if (map.has(key)) return map.get(key);
  const pending = load().catch((error) => {
    map.delete(key);
    throw error;
  });
  map.set(key, pending);
  return pending;
}

function collectSkillTreeEntries(source, treeEntries) {
  const sourcePath = source.path;
  const prefix = `${sourcePath}/`;
  let foundSource = false;
  const entries = [];
  const seen = new Set();

  for (const entry of treeEntries) {
    if (!isPlainObject(entry) || typeof entry.path !== "string") continue;
    if (entry.path === sourcePath) {
      foundSource = true;
      if (entry.type !== "tree") {
        throw new Error(
          `${source.repository}:${source.path} is not a directory in ${source.ref} (type ${String(entry.type)}).`,
        );
      }
      continue;
    }
    if (!entry.path.startsWith(prefix)) continue;

    const relativePath = parseRelativePath(
      entry.path.slice(prefix.length),
      `${source.repository}:${entry.path}`,
    );

    if (entry.type === "tree") {
      foundSource = true;
      continue;
    }
    if (entry.type !== "blob") {
      throw new Error(
        `${source.repository}:${entry.path} has unsupported type ${String(entry.type)}; only files are supported.`,
      );
    }
    if (entry.mode === "120000") {
      throw new Error(
        `${source.repository}:${entry.path} is a symlink; symlinks are not supported.`,
      );
    }
    if (entry.mode !== "100644" && entry.mode !== "100755") {
      throw new Error(
        `${source.repository}:${entry.path} has mode ${String(entry.mode)}; only regular files are supported.`,
      );
    }
    if (typeof entry.sha !== "string" || entry.sha === "") {
      throw new Error(`${source.repository}:${entry.path} has no blob sha.`);
    }
    if (seen.has(relativePath)) {
      throw new Error(`${source.repository}:${source.path} has duplicate path ${relativePath}.`);
    }

    foundSource = true;
    seen.add(relativePath);
    entries.push({ relativePath, blobSha: entry.sha, mode: entry.mode });
  }

  if (!foundSource) {
    throw new Error(`${source.repository}:${source.path} not found at ${source.ref}.`);
  }
  if (entries.length === 0) {
    throw new Error(`${source.repository}:${source.path} contains no files at ${source.ref}.`);
  }

  entries.sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
  return entries;
}

function toLockEntry(source, fetched) {
  const files = createRecord();
  for (const path of Object.keys(fetched.files).sort()) {
    const file = fetched.files[path];
    files[path] = { sha256: sha256(file.bytes), mode: file.mode };
  }

  return {
    source: {
      repository: source.repository,
      path: source.path,
      ref: source.ref,
      trackingBranch: source.trackingBranch,
    },
    installedCommit: fetched.commitSha,
    files,
    _bytes: fetched.files,
  };
}

async function applyTransaction(root, { updates, lockContent }, testHooks) {
  await assertSafeFilesystemAnchors(root);

  const stageParent = join(root, ".agents");
  await mkdir(stageParent, { recursive: true });

  const stageRoot = await mkdtemp(join(stageParent, ".skills-stage-"));
  const backupRoot = join(stageRoot, ".backup");
  const stageSkillsRoot = join(stageRoot, "skills");
  const stageLockPath = join(stageRoot, LOCK_FILENAME);

  const skillOperations = updates.map(({ name }) => ({
    name,
    sourceDirectory: join(stageSkillsRoot, name),
    targetDirectory: join(root, SKILLS_DIRECTORY, name),
    backupDirectory: join(backupRoot, SKILLS_DIRECTORY, name),
    movedOriginal: false,
    installedNew: false,
  }));

  const lockPath = join(root, LOCK_FILENAME);
  const lockOperation = {
    backupPath: join(backupRoot, LOCK_FILENAME),
    movedOriginal: false,
    installedNew: false,
  };

  try {
    await mkdir(stageSkillsRoot, { recursive: true });
    for (const { name, desired } of updates) {
      await writeSnapshot(join(stageSkillsRoot, name), desired._bytes);
    }
    await writeFile(stageLockPath, lockContent);
    await chmod(stageLockPath, 0o644);

    for (const operation of skillOperations) {
      const current = await statOrUndefined(operation.targetDirectory);
      if (current) {
        if (current.isSymbolicLink() || !current.isDirectory()) {
          throw new Error(`${SKILLS_DIRECTORY}/${operation.name}: expected a directory.`);
        }
        await mkdir(dirname(operation.backupDirectory), { recursive: true });
        await rename(operation.targetDirectory, operation.backupDirectory);
        operation.movedOriginal = true;
      }

      if (testHooks.failAfterBackup === operation.name) {
        throw new Error(`Test hook: fail after backing up ${SKILLS_DIRECTORY}/${operation.name}.`);
      }

      await mkdir(dirname(operation.targetDirectory), { recursive: true });
      await rename(operation.sourceDirectory, operation.targetDirectory);
      operation.installedNew = true;
    }

    const existingLock = await statOrUndefined(lockPath);
    if (existingLock) {
      if (existingLock.isSymbolicLink() || !existingLock.isFile()) {
        throw new Error(`${LOCK_FILENAME} must be a regular file.`);
      }
      await mkdir(dirname(lockOperation.backupPath), { recursive: true });
      await rename(lockPath, lockOperation.backupPath);
      lockOperation.movedOriginal = true;
    }

    await rename(stageLockPath, lockPath);
    lockOperation.installedNew = true;

    if (testHooks.failAfterLock) throw new Error("Test hook: fail after installing lock file.");
  } catch (error) {
    const rollbackErrors = [];

    if (lockOperation.movedOriginal) {
      try {
        await rename(lockOperation.backupPath, lockPath);
        lockOperation.movedOriginal = false;
        lockOperation.installedNew = false;
      } catch (rollbackError) {
        rollbackErrors.push(
          `${LOCK_FILENAME}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    } else if (lockOperation.installedNew) {
      try {
        await rm(lockPath, { recursive: true, force: true });
        lockOperation.installedNew = false;
      } catch (rollbackError) {
        rollbackErrors.push(
          `${LOCK_FILENAME}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    }

    for (const operation of [...skillOperations].reverse()) {
      if (!operation.installedNew && !operation.movedOriginal) continue;
      try {
        if (operation.installedNew) {
          await rm(operation.targetDirectory, { recursive: true, force: true });
          operation.installedNew = false;
        }
        if (operation.movedOriginal) {
          await rename(operation.backupDirectory, operation.targetDirectory);
          operation.movedOriginal = false;
        }
      } catch (rollbackError) {
        rollbackErrors.push(
          `${SKILLS_DIRECTORY}/${operation.name}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    }

    if (rollbackErrors.length > 0) {
      throw new Error(
        `Skills update transaction failed: ${error.message}. ` +
          `Rollback failed (${rollbackErrors.join("; ")}). Recovery data kept at ${stageRoot}.`,
        { cause: error },
      );
    }

    try {
      await rm(stageRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new Error(
        `Skills update transaction failed: ${error.message}. ` +
          `Rollback succeeded, but staging cleanup failed: ${cleanupError.message}. ` +
          `Recovery data kept at ${stageRoot}.`,
        { cause: cleanupError },
      );
    }

    throw new Error(`Skills update transaction failed: ${error.message}`, { cause: error });
  }

  try {
    await rm(stageRoot, { recursive: true, force: true });
  } catch (cleanupError) {
    throw new Error(
      `Skills update committed but could not clean staging directory ${stageRoot}: ${cleanupError.message}.`,
      { cause: cleanupError },
    );
  }
}

async function writeSnapshot(directory, files) {
  await mkdir(directory, { recursive: true });
  for (const relativePath of Object.keys(files).sort()) {
    const file = files[relativePath];
    const path = join(directory, ...relativePath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
    await chmod(path, file.mode === "100755" ? 0o755 : 0o644);
  }
}

async function githubJson(path, { fetch, token }) {
  return requestJson(`https://api.github.com${path}`, {
    fetchImplementation: fetch,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "gq-site-skills-updater",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    errorMessage: (response, payload) =>
      `GitHub API ${path} failed with HTTP ${response.status}${
        payload?.message ? `: ${payload.message}` : ""
      }.`,
  });
}

function sortedLock({ skills }) {
  const sorted = createRecord();
  for (const name of Object.keys(skills).sort()) {
    const entry = skills[name];
    const files = createRecord();
    for (const path of Object.keys(entry.files).sort()) files[path] = entry.files[path];

    sorted[name] = {
      source: {
        repository: entry.source.repository,
        path: entry.source.path,
        ref: entry.source.ref,
        trackingBranch: entry.source.trackingBranch,
      },
      installedCommit: entry.installedCommit,
      files,
    };
  }
  return { schemaVersion: SCHEMA_VERSION, skills: sorted };
}

function sameEntry(a, b) {
  if (!a) return false;
  return (
    JSON.stringify(sortedLock({ skills: { x: a } }).skills.x) ===
    JSON.stringify(sortedLock({ skills: { x: b } }).skills.x)
  );
}

function validateSkillName(name, label) {
  if (typeof name !== "string" || name === "") throw new Error(`${label} key must be a string.`);
  if (RESERVED_SKILL_KEYS.has(name)) {
    throw new Error(`${label} uses reserved skill key ${JSON.stringify(name)}.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
    throw new Error(`${label} is not a valid local skill directory name.`);
  }
}

function parseRelativePath(value, label) {
  if (typeof value !== "string" || value === "") throw new Error(`${label} must be a string.`);
  if (value.trim() !== value) {
    throw new Error(`${label} must not include surrounding whitespace.`);
  }
  if (value.includes("\\")) {
    throw new Error(`${label} must use '/' separators (backslash is not allowed).`);
  }
  if (value.includes("\u0000")) {
    throw new Error(`${label} must not contain NUL bytes.`);
  }
  if (value.startsWith("/")) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }

  const segments = value.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`${label} must not contain empty, '.' or '..' segments.`);
    }
  }
  return value;
}

function expectTrimmedString(value, label) {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} must be a string.`);
  return value.trim();
}

function encodeRepository(repository) {
  const [owner, name] = repository.split("/");
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function shortSha(sha) {
  return sha.slice(0, 12);
}

function parseBlobSize(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} has invalid declared size ${JSON.stringify(value)}.`);
  }
  return value;
}

function encodedLengthForBytes(bytes) {
  return Math.ceil(bytes / 3) * 4;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cloneRecord(source) {
  const copy = createRecord();
  for (const key of Object.keys(source)) copy[key] = source[key];
  return copy;
}

function createRecord() {
  return Object.create(null);
}

function setUnique(object, key, label) {
  if (Object.hasOwn(object, key))
    throw new Error(`${label} has duplicate key ${JSON.stringify(key)}.`);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(path) {
  return (await statOrUndefined(path)) !== undefined;
}

async function statOrUndefined(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readOptionalText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readText(path, missingMessage) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${missingMessage}.`, { cause: error });
    throw error;
  }
}
