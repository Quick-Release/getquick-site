// gq sync: brings a site up to the installed blueprint: pending gq.ops.json
// schema migrations are applied, a leftover release config module
// (shop-devtools.config.mjs) is folded in and removed, and the file is written
// back; then the managed files are regenerated and gq.lock.json updated. With
// --check every pending change is reported (exit 1) and nothing written. A
// managed file edited since gq last wrote it stops sync with a diff, and
// nothing is written.
// `--manifest` limits sync to the manifest. Needs no network and no secrets.
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  MANIFEST_FILENAME,
  migrateManifest,
  migrationCommand,
  readManifestFile,
  writeManifest,
} from "../manifest/manifest.mjs";
import { MigrationInputError } from "../manifest/migrations.mjs";
import {
  foldReleaseConfig,
  readReleaseConfig,
  RELEASE_CONFIG_FILENAME,
} from "../manifest/release-config.mjs";
import { SCHEMA_VERSION, VARIANTS } from "../manifest/schema.mjs";
import { locateProjectConfig } from "../ops/project-context.mjs";
import { unifiedDiff } from "./diff.mjs";
import { applyManagedFiles, LOCK_FILENAME, planManagedFiles } from "./managed-files.mjs";

export const SYNC_USAGE = [`gq sync [--manifest] [--check] [--variant <${VARIANTS.join("|")}>]`];

const FLAGS = { "--manifest": "manifest", "--check": "check" };
const VALUE_OPTIONS = { "--variant": "variant", "--project": "project", "--config": "config" };

export function isSyncCommand(argv) {
  return argv[0] === "sync";
}

// Resolves to the exit code.
export async function runSyncCommand(args, { cwd, io }) {
  const options = parseSyncArguments(args);
  const path = await locateProjectConfig({ cwd, project: options.project, config: options.config });
  const root = dirname(path);
  const current = await readManifestFile(path);
  const releaseConfig = await readReleaseConfig(root);
  let migrated;
  try {
    migrated = migrateManifest(current, { variant: options.variant });
  } catch (error) {
    // --check reports drift even when applying it would need more input.
    if (!(options.check && error instanceof MigrationInputError)) throw error;
    const command = migrationCommand(0, current.variant);
    reportPending(io, current.schemaVersion ?? 0, command);
    if (releaseConfig) reportFoldPending(io, command);
    return 1;
  }
  const { from, warnings } = migrated;
  for (const warning of warnings) io.err(`warning: ${MANIFEST_FILENAME} ${warning}`);
  let { manifest } = migrated;
  if (releaseConfig) {
    const folded = foldReleaseConfig(manifest, releaseConfig);
    for (const warning of folded.warnings) io.err(`warning: ${RELEASE_CONFIG_FILENAME} ${warning}`);
    manifest = folded.manifest;
  }

  const migrating = from < SCHEMA_VERSION;
  if (!migrating && options.variant && options.variant !== manifest.variant) {
    throw new Error(
      `${MANIFEST_FILENAME} declares variant ${manifest.variant}; --variant ${options.variant} ` +
        "only applies when migrating a v0 manifest.",
    );
  }
  const manifestPending = migrating || Boolean(releaseConfig);
  const plan = options.manifest ? undefined : await planManagedFiles(root, manifest);
  const files = plan ? [...plan.files, plan.lock] : [];
  const pendingFiles = files.filter(({ status }) => status === "create" || status === "update");
  const editedFiles = files.filter(({ status }) => status === "edited");

  // Report, write nothing: with --check, or when writing would discard an edit.
  if (options.check || editedFiles.length > 0) {
    if (manifestPending) {
      const command = options.variant
        ? `gq sync --manifest --variant ${options.variant}`
        : migrationCommand(from, current.variant);
      if (migrating) reportPending(io, from, command);
      if (releaseConfig) reportFoldPending(io, command);
    } else reportUpToDate(io);
    if (plan) {
      reportManagedFiles(io, pendingFiles, { check: true, quiet: editedFiles.length > 0 });
    }
    for (const file of editedFiles) reportEdit(io, file);
    if (editedFiles.length > 0) {
      throw new Error(
        `Local edits to managed files: ${editedFiles.map(({ path }) => path).join(", ")}. ` +
          "gq sync writes nothing until each is reverted, or deleted to be regenerated.",
      );
    }
    return !manifestPending && pendingFiles.length === 0 ? 0 : 1;
  }

  if (!manifestPending) reportUpToDate(io);
  else {
    await writeManifest(path, manifest);
    if (migrating) io.out(`${MANIFEST_FILENAME}: migrated schema v${from} → v${SCHEMA_VERSION}.`);
    if (releaseConfig) {
      await rm(join(root, RELEASE_CONFIG_FILENAME));
      io.out(`${MANIFEST_FILENAME}: folded in ${RELEASE_CONFIG_FILENAME} and removed it.`);
    }
  }
  if (plan) {
    await applyManagedFiles(root, plan);
    reportManagedFiles(io, pendingFiles, { check: false });
  }
  return 0;
}

function reportUpToDate(io) {
  io.out(`${MANIFEST_FILENAME}: up to date (schema v${SCHEMA_VERSION}).`);
}

// `quiet` leaves out the "up to date" line, when an edit is all there is.
function reportManagedFiles(io, pending, { check, quiet = false }) {
  if (pending.length === 0 && !quiet) io.out("Managed files: up to date.");
  for (const { path, status } of pending) {
    if (check) io.out(`${path}: pending, gq sync would ${status} it.`);
    else io.out(`${path}: ${status === "create" ? "created" : "updated"}.`);
  }
}

function reportEdit(io, { path, current, content }) {
  io.out(`${path}: edited since gq last wrote it (${LOCK_FILENAME}); gq sync would write:`);
  for (const line of unifiedDiff(path, current.toString("utf8"), content.toString("utf8"))) {
    io.out(line);
  }
}

function reportPending(io, from, command) {
  io.out(
    `${MANIFEST_FILENAME}: schema v${from} → v${SCHEMA_VERSION} pending. Run ${command} to apply it.`,
  );
}

function reportFoldPending(io, command) {
  io.out(
    `${RELEASE_CONFIG_FILENAME}: folding into ${MANIFEST_FILENAME} pending. Run ${command} to apply it.`,
  );
}

function parseSyncArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const flag = FLAGS[argument];
    const option = VALUE_OPTIONS[argument];
    if (flag && !options[flag]) options[flag] = true;
    else if (option && options[option] === undefined && args[index + 1] !== undefined) {
      options[option] = args[index + 1];
      index += 1;
    } else throw new Error(`Usage: ${SYNC_USAGE[0]}`);
  }
  return options;
}
