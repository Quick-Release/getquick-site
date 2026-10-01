import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { loadManifest, MANIFEST_FILENAME } from "../manifest/manifest.mjs";
import { readEnvFile } from "./env.mjs";

export async function findProjectConfig(startDirectory) {
  let directory = await realpath(resolve(startDirectory));

  while (true) {
    const candidate = join(directory, MANIFEST_FILENAME);
    if (await exists(candidate)) return candidate;
    if (await exists(join(directory, ".git"))) return null;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

// The canonical path of the gq.ops.json `options` select: `config`, else the
// one in `project`, else the nearest one above `cwd`.
export async function locateProjectConfig(options) {
  const configPath = await resolveConfigPath(options);
  if (!configPath) {
    throw new Error(
      `No ${MANIFEST_FILENAME} found from ${resolve(options.cwd)}. ` +
        "Run inside a configured project or pass --project/--config.",
    );
  }
  return realpath(configPath);
}

// `cwd` and `env` are the run() seam's; nothing here reads the process's own.
// `config` is the validated manifest (see manifest/manifest.mjs).
export async function loadProjectContext(options) {
  const canonicalConfigPath = await locateProjectConfig(options);
  const projectRoot = dirname(canonicalConfigPath);
  const config = await loadManifest(canonicalConfigPath);
  const machineEnvPath = getMachineEnvPath(options.env);
  const [machineEnv, projectEnv] = await Promise.all([
    machineEnvPath ? readEnvFile(machineEnvPath) : {},
    readEnvFile(join(projectRoot, ".env")),
  ]);

  return {
    config,
    configPath: canonicalConfigPath,
    projectRoot,
    invocationDirectory: await realpath(resolve(options.cwd)),
    machineEnvPath,
    env: {
      ...machineEnv,
      ...projectEnv,
      ...options.env,
    },
    resolvePath(path) {
      return isAbsolute(path) ? path : resolve(projectRoot, path);
    },
  };
}

async function resolveConfigPath(options) {
  if (options.config) return resolve(options.cwd, options.config);
  if (options.project) {
    const project = resolve(options.cwd, options.project);
    return project.endsWith(MANIFEST_FILENAME) ? project : join(project, MANIFEST_FILENAME);
  }
  return findProjectConfig(options.cwd);
}

// Without XDG_CONFIG_HOME or HOME there is no machine file to read.
function getMachineEnvPath(environment) {
  const configHome =
    environment.XDG_CONFIG_HOME || (environment.HOME ? join(environment.HOME, ".config") : null);
  return configHome ? join(configHome, "gq", "ops.env") : null;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
