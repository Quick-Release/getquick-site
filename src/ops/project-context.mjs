import { access, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { readEnvFile } from "./env.mjs";

export const CONFIG_FILENAME = "gq.ops.json";

export async function findProjectConfig(startDirectory) {
  let directory = await realpath(resolve(startDirectory));

  while (true) {
    const candidate = join(directory, CONFIG_FILENAME);
    if (await exists(candidate)) return candidate;
    if (await exists(join(directory, ".git"))) return null;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

// `cwd` and `env` are the run() seam's; nothing here reads the process's own.
export async function loadProjectContext(options) {
  const configPath = await resolveConfigPath(options);
  if (!configPath) {
    throw new Error(
      `No ${CONFIG_FILENAME} found from ${resolve(options.cwd)}. ` +
        "Run inside a configured project or pass --project/--config.",
    );
  }

  const canonicalConfigPath = await realpath(configPath);
  const projectRoot = dirname(canonicalConfigPath);
  const config = validateConfig(await readConfig(canonicalConfigPath));
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
    return project.endsWith(CONFIG_FILENAME) ? project : join(project, CONFIG_FILENAME);
  }
  return findProjectConfig(options.cwd);
}

async function readConfig(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${path} is not valid JSON: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}

function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${CONFIG_FILENAME} must contain a configuration object.`);
  }
  if (typeof config.project !== "string" || !config.project.trim()) {
    throw new Error(`${CONFIG_FILENAME} must define a non-empty project name.`);
  }
  return config;
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
