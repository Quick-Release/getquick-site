// gq sync: brings a site up to the installed blueprint. Today that is its
// gq.ops.json: pending schema migrations are applied and the file written
// back, or, with --check, reported (exit 1) without writing anything.
// `--manifest` limits sync to the manifest. Needs no network and no secrets.
import {
  MANIFEST_FILENAME,
  migrateManifest,
  migrationCommand,
  readManifestFile,
  writeManifest,
} from "../manifest/manifest.mjs";
import { MigrationInputError } from "../manifest/migrations.mjs";
import { SCHEMA_VERSION, VARIANTS } from "../manifest/schema.mjs";
import { locateProjectConfig } from "../ops/project-context.mjs";

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
  const current = await readManifestFile(path);
  let migrated;
  try {
    migrated = migrateManifest(current, { variant: options.variant });
  } catch (error) {
    // --check reports drift even when applying it would need more input.
    if (!(options.check && error instanceof MigrationInputError)) throw error;
    reportPending(io, current.schemaVersion ?? 0, migrationCommand(0, current.variant));
    return 1;
  }
  const { manifest, from, warnings } = migrated;
  for (const warning of warnings) io.err(`warning: ${MANIFEST_FILENAME} ${warning}`);

  if (from === SCHEMA_VERSION) {
    if (options.variant && options.variant !== manifest.variant) {
      throw new Error(
        `${MANIFEST_FILENAME} declares variant ${manifest.variant}; --variant ${options.variant} ` +
          "only applies when migrating a v0 manifest.",
      );
    }
    io.out(`${MANIFEST_FILENAME}: up to date (schema v${SCHEMA_VERSION}).`);
    return 0;
  }
  if (options.check) {
    const command = options.variant
      ? `gq sync --manifest --variant ${options.variant}`
      : migrationCommand(from, current.variant);
    reportPending(io, from, command);
    return 1;
  }
  await writeManifest(path, manifest);
  io.out(`${MANIFEST_FILENAME}: migrated schema v${from} → v${SCHEMA_VERSION}.`);
  return 0;
}

function reportPending(io, from, command) {
  io.out(
    `${MANIFEST_FILENAME}: schema v${from} → v${SCHEMA_VERSION} pending. Run ${command} to apply it.`,
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
