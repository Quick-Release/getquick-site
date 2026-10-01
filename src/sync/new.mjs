// gq new: creates a site from the blueprint in a new directory: a v1
// gq.ops.json, the managed files and gq.lock.json, then `git init`. Needs no
// network and no secrets; provisioning stays in the existing commands.
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { MANIFEST_FILENAME, validateManifest, writeManifest } from "../manifest/manifest.mjs";
import { SCHEMA_URL, SCHEMA_VERSION } from "../manifest/schema.mjs";
import { applyManagedFiles, planManagedFiles } from "./managed-files.mjs";

export const NEW_USAGE = ["gq new <dir> --project <name> --variant content"];

const VALUE_OPTIONS = { "--project": "project", "--variant": "variant" };

export function isNewCommand(argv) {
  return argv[0] === "new";
}

export async function runNewCommand(args, { cwd, env, exec, io }) {
  const { directory, project, variant } = parseNewArguments(args);
  if (variant === "commerce") {
    throw new Error("gq new --variant commerce is not supported until phase 4.");
  }
  const manifest = validateManifest({
    $schema: SCHEMA_URL,
    schemaVersion: SCHEMA_VERSION,
    project,
    variant,
  });
  const root = resolve(cwd, directory);
  if ((await readDirectoryIfExists(root))?.length > 0) throw new Error(`${root} is not empty.`);

  await mkdir(root, { recursive: true });
  await writeManifest(join(root, MANIFEST_FILENAME), manifest);
  const plan = await planManagedFiles(root, manifest);
  await applyManagedFiles(root, plan);
  const result = await exec("git", ["init", "--quiet"], { cwd: root, env });
  if (result.code !== 0) {
    throw new Error(`git init failed in ${root}: ${(result.stderr || result.stdout).trim()}`);
  }

  io.out(`Created ${project} (${variant}) in ${root}:`);
  for (const { path } of [{ path: MANIFEST_FILENAME }, ...plan.files, plan.lock]) {
    io.out(`  ${path}`);
  }
  return 0;
}

async function readDirectoryIfExists(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function parseNewArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const option = VALUE_OPTIONS[argument];
    if (option && options[option] === undefined && args[index + 1] !== undefined) {
      options[option] = args[index + 1];
      index += 1;
    } else if (!argument.startsWith("--") && options.directory === undefined) {
      options.directory = argument;
    } else throw new Error(`Usage: ${NEW_USAGE[0]}`);
  }
  if (!options.directory || !options.project || !options.variant) {
    throw new Error(`Usage: ${NEW_USAGE[0]}`);
  }
  return options;
}
