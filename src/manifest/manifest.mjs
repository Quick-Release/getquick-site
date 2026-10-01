// Reading, validating, migrating and writing gq.ops.json. Commands get the
// manifest from `loadManifest`, which refuses any schema version but the one
// this gq reads; only `gq sync` reads an older one (`readManifestFile`) to
// migrate it. Every write goes through `writeManifest`, which validates first.
import { readFile, writeFile } from "node:fs/promises";

import { VERSION } from "../version.mjs";
import { MIGRATIONS } from "./migrations.mjs";
import { MANIFEST_FILENAME, manifestSchema, SCHEMA_VERSION, VARIANTS } from "./schema.mjs";

export { MANIFEST_FILENAME };

// The JSON in `path`, any schema version.
export async function readManifestFile(path) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${path} is not valid JSON: ${error.message}`, { cause: error });
    }
    throw error;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`${MANIFEST_FILENAME} must contain a configuration object.`);
  }
  return manifest;
}

// The validated manifest in `path`, refused unless it is the current version.
export async function loadManifest(path) {
  const manifest = await readManifestFile(path);
  assertCurrentVersion(manifest);
  return validateManifest(manifest);
}

// The gq sync invocation that migrates a v`from` manifest: v0 never recorded
// the variant, so migrating it takes --variant unless the manifest has one.
export function migrationCommand(from, variant) {
  if (from > 0 || VARIANTS.includes(variant)) return "gq sync --manifest";
  return `gq sync --manifest --variant <${VARIANTS.join("|")}>`;
}

// Applies every pending migration to `manifest`. `options` carries what a
// migration can't derive (the variant). Returns the migrated manifest, the
// version it started from, and the migrations' warnings; `from` equals
// SCHEMA_VERSION when nothing was pending.
export function migrateManifest(manifest, options = {}) {
  const from = schemaVersionOf(manifest);
  let current = manifest;
  const warnings = [];
  for (let version = from; version < SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version](current, options);
    current = step.manifest;
    warnings.push(...step.warnings);
  }
  validateManifest(current);
  return { manifest: current, from, warnings };
}

// Validates `manifest`, then writes it as formatted JSON.
export async function writeManifest(path, manifest) {
  validateManifest(manifest);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

// Reads the current-version manifest in `path`, applies `change` to a copy of
// it as written (keeping its key order), and writes it back validated.
export async function updateManifest(path, change) {
  const manifest = await readManifestFile(path);
  assertCurrentVersion(manifest);
  change(manifest);
  await writeManifest(path, manifest);
}

function assertCurrentVersion(manifest) {
  const version = schemaVersionOf(manifest);
  if (version < SCHEMA_VERSION) {
    throw new Error(
      `${MANIFEST_FILENAME} is schema v${version}, older than this gq reads (v${SCHEMA_VERSION}). ` +
        `Run ${migrationCommand(version, manifest.variant)} to migrate it.`,
    );
  }
}

// A missing (or 0) schemaVersion is v0, the shape before versioning. No gq
// reads, or migrates, a manifest newer than its own schema.
function schemaVersionOf(manifest) {
  const version = manifest.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`${MANIFEST_FILENAME} schemaVersion must be a non-negative integer.`);
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `${MANIFEST_FILENAME} is schema v${version}, newer than gq ${VERSION} reads ` +
        `(v${SCHEMA_VERSION}). Update @getquick/site.`,
    );
  }
  return version;
}

function validateManifest(manifest) {
  const result = manifestSchema.safeParse(manifest, { reportInput: true });
  if (result.success) return result.data;
  const problems = result.error.issues.flatMap(describeIssue);
  throw new Error(`${MANIFEST_FILENAME} is invalid: ${problems.join("; ")}.`);
}

function describeIssue(issue) {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => `${keyPath([...issue.path, key])} is not a known key`);
  }
  const path = keyPath(issue.path);
  if (issue.code === "invalid_type" && issue.input === undefined) return `${path} is required`;
  if (issue.code === "too_small" && issue.origin === "string") return `${path} must not be empty`;
  if (issue.code === "custom") return `${path} ${issue.message}`;
  if (issue.code === "invalid_value") {
    return `${path} must be ${issue.values.map((value) => JSON.stringify(value)).join(" or ")}`;
  }
  return `${path}: ${issue.message}`;
}

// ["wordpress", "plugins", 0] → wordpress.plugins[0];
// ["doctor", "requiredFiles", "apps/cms"] → doctor.requiredFiles["apps/cms"]
function keyPath(path) {
  return path
    .map((key, index) => {
      if (typeof key === "number") return `[${key}]`;
      if (!/^[A-Za-z_$][\w$]*$/u.test(String(key))) return `[${JSON.stringify(String(key))}]`;
      return `${index === 0 ? "" : "."}${String(key)}`;
    })
    .join("");
}
