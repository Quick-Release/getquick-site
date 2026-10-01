// The local Design source override (Lombardi's scripts/lib/cms-local-design.mjs):
// a developer opts in with an ignored apps/cms/.local-plugins/config.json
// naming a getquick-design checkout, which is then symlinked over the
// registry copy and bind-mounted into DDEV. Composer only ever sees the
// registry copy: dependency changes unlink the checkout, run, and relink under
// a filesystem lock. CI never consults the override.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { hostname } from "node:os";

function stat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function validateDestinations(cmsRoot) {
  // A symlinked ancestor could alias the checkout despite a normal final entry.
  for (const path of [
    join(cmsRoot, ".local-plugins"),
    join(cmsRoot, "web"),
    join(cmsRoot, "web/app"),
    join(cmsRoot, "web/app/plugins"),
  ]) {
    const entry = stat(path);
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
      throw new Error(`Refusing an unsafe local plugin ancestor: ${path}`);
    }
  }
}

// Opt-in state stays outside Git. CI never consults a developer's override.
export function localDesignOverride(cmsRoot, env) {
  if (env.CI) return null;
  const state = join(cmsRoot, ".local-plugins");
  const config = join(state, "config.json");
  if (!existsSync(config)) return null;
  validateDestinations(cmsRoot);
  const { getquickDesign } = JSON.parse(readFileSync(config, "utf8"));
  if (typeof getquickDesign !== "string" || !isAbsolute(getquickDesign)) {
    throw new Error(`${config} needs an absolute getquickDesign checkout path.`);
  }
  const source = realpathSync(getquickDesign);
  const withinCms = relative(realpathSync(cmsRoot), source);
  if (!withinCms.startsWith("../") && !isAbsolute(withinCms)) {
    throw new Error("The Design source checkout must be outside apps/cms.");
  }
  if (!stat(source)?.isDirectory() || !existsSync(join(source, "getquick-design.php"))) {
    throw new Error(`Not a Design checkout: ${source}`);
  }
  return {
    source,
    state,
    plugin: join(cmsRoot, "web/app/plugins/getquick-design"),
    backup: join(state, "getquick-design-release"),
    compose: join(cmsRoot, ".ddev/docker-compose.getquick-design.local.yaml"),
    hooks: join(cmsRoot, ".ddev/config.getquick-design.local.yaml"),
    lock: join(state, "design-operation.lock"),
  };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return true; // Permission errors are not evidence that the owner is dead.
  }
}

function recoverLock(override) {
  if (!stat(override.lock)?.isDirectory() || stat(override.lock)?.isSymbolicLink()) {
    throw new Error("The existing operation lock is not a safe directory.");
  }
  const recovery = `${override.lock}.recovery`;
  // Serialize stale-lock reclamation so two callers cannot remove a new lock.
  mkdirSync(recovery);
  try {
    const owner = JSON.parse(readFileSync(join(override.lock, "owner.json"), "utf8"));
    if (
      owner.host !== hostname() ||
      !Number.isInteger(owner.pid) ||
      owner.pid <= 0 ||
      processAlive(owner.pid)
    ) {
      throw new Error("The operation owner is still alive or cannot be verified.");
    }
    const command = join(override.lock, "command.pid");
    if (existsSync(command)) {
      const pid = Number(readFileSync(command, "utf8").trim());
      if (!Number.isInteger(pid) || pid <= 0 || processAlive(pid)) {
        throw new Error("The Composer/DDEV child is still alive or cannot be verified.");
      }
      unlinkSync(command);
    }
    unlinkSync(join(override.lock, "owner.json"));
    rmdirSync(override.lock);
  } finally {
    rmdirSync(recovery);
  }
}

function locked(override, action) {
  const label = override.label ?? "Design";
  mkdirSync(override.state, { recursive: true });
  if (existsSync(`${override.lock}.recovery`)) {
    const error = new Error(`Another local ${label} operation is recovering its lock.`);
    error.code = "CMS_LOCAL_OPERATION_BUSY";
    throw error;
  }
  try {
    mkdirSync(override.lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      recoverLock(override);
      mkdirSync(override.lock);
    } catch (cause) {
      const error = new Error(
        `Another local ${label} operation is running or needs inspection (${override.lock}): ${cause.message}`,
      );
      error.code = "CMS_LOCAL_OPERATION_BUSY";
      throw error;
    }
  }
  writeFileSync(
    join(override.lock, "owner.json"),
    JSON.stringify({ pid: process.pid, host: hostname() }),
  );
  const release = () => {
    const command = join(override.lock, "command.pid");
    if (existsSync(command)) unlinkSync(command);
    unlinkSync(join(override.lock, "owner.json"));
    rmdirSync(override.lock);
  };
  let result;
  try {
    result = action();
  } catch (error) {
    release();
    throw error;
  }
  if (result instanceof Promise) return result.finally(release);
  release();
  return result;
}

// Also serialize background-start launchers, before they publish a new job.
export function withCmsLocalOperation(cmsRoot, name, action) {
  validateDestinations(cmsRoot);
  if (!/^[a-z-]+$/u.test(name)) throw new Error("Invalid local operation name.");
  const state = join(cmsRoot, ".local-plugins");
  return locked({ state, lock: join(state, `${name}-operation.lock`), label: name }, action);
}

// Record the exec'd child PID before it runs. If this Node process is killed,
// startup may reclaim its lock only after that command is also gone. Pending
// or unverified ownership is conservatively refused, never deleted blindly.
// `options` goes to run()'s exec as is (cwd, env, output streams).
export function runDesignCommand(exec, command, args, override, options) {
  if (!override) return exec(command, args, options);
  const pidFile = join(override.lock, "command.pid");
  writeFileSync(pidFile, "pending");
  return exec(
    "sh",
    ["-c", 'printf "%s\\n" "$$" > "$1"; shift; exec "$@"', "sh", pidFile, command, ...args],
    options,
  );
}

function inspect(override) {
  const plugin = stat(override.plugin);
  const backup = stat(override.backup);
  if (backup && (!backup.isDirectory() || backup.isSymbolicLink())) {
    throw new Error(`Refusing an unsafe registry backup: ${override.backup}`);
  }
  if (plugin?.isSymbolicLink()) {
    const target = resolve(override.plugin, "..", readlinkSync(override.plugin));
    if (target !== override.source) {
      throw new Error(`Refusing to replace a different plugin symlink: ${override.plugin}`);
    }
  } else if (plugin && !plugin.isDirectory()) {
    throw new Error(`Refusing to replace a non-directory: ${override.plugin}`);
  } else if (plugin && backup) {
    throw new Error(
      "Both the installed Design directory and its backup exist; refusing to overwrite either.",
    );
  }
  return { plugin, backup };
}

function link(override) {
  const { plugin } = inspect(override);
  if (!plugin?.isSymbolicLink()) {
    if (plugin) renameSync(override.plugin, override.backup);
    mkdirSync(join(override.plugin, ".."), { recursive: true });
    symlinkSync(override.source, override.plugin, "dir");
  }
  // Quote paths as YAML strings. Mount the identical absolute path so both
  // Composer on the host and WordPress in DDEV can resolve the same symlink.
  const path = JSON.stringify(override.source);
  const compose = `# Generated from ignored .local-plugins/config.json; local development only.\nservices:\n  web:\n    volumes:\n      - type: bind\n        source: ${path}\n        target: ${path}\n        read_only: true\n        bind:\n          create_host_path: false\n`;
  mkdirSync(join(override.compose, ".."), { recursive: true });
  if (!existsSync(override.compose) || readFileSync(override.compose, "utf8") !== compose) {
    writeFileSync(override.compose, compose);
  }
  // Lombardi's own copy of this module writes the same hooks until its DDEV
  // startup moves into gq; both must agree, or each run rewrites the other's.
  const hooks = `# Generated local-only hooks; not shipped to CI or staging.\nhooks:\n  pre-start:\n    - exec-host: node ../../scripts/cms-local-design.mjs\n  post-start:\n    - exec-host: node ../../scripts/cms-local-design.mjs refresh\n`;
  if (!existsSync(override.hooks) || readFileSync(override.hooks, "utf8") !== hooks) {
    writeFileSync(override.hooks, hooks);
  }
}

export function syncLocalDesign(cmsRoot, env) {
  const override = localDesignOverride(cmsRoot, env);
  if (!override) return false;
  locked(override, () => link(override));
  return true;
}

export function withLinkedLocalDesign(cmsRoot, action, env) {
  const override = localDesignOverride(cmsRoot, env);
  if (!override) return null;
  return locked(override, () => {
    link(override);
    return action(override);
  });
}

// `action` may be async; the checkout is relinked, and `afterRelink` run, once
// it settles, still under the lock and also when it fails, before its error
// is propagated.
export async function withDesignRegistryInstall(cmsRoot, action, { env, afterRelink = () => {} }) {
  const override = localDesignOverride(cmsRoot, env);
  if (!override) {
    // A missing/disabled opt-in must not hand an existing symlink to Composer.
    // Normal CI/staging installs are ordinary directories and take this path.
    validateDestinations(cmsRoot);
    if (stat(join(cmsRoot, "web/app/plugins/getquick-design"))?.isSymbolicLink()) {
      throw new Error(
        "Refusing Composer dependency changes on a Design symlink without an active local override.",
      );
    }
    return action(null);
  }
  return locked(override, async () => {
    const { plugin, backup } = inspect(override);
    if (plugin?.isSymbolicLink()) {
      unlinkSync(override.plugin);
      if (backup) renameSync(override.backup, override.plugin);
    } else if (!plugin && backup) {
      renameSync(override.backup, override.plugin);
    }
    try {
      return await action(override);
    } finally {
      link(override);
      await afterRelink(override);
    }
  });
}
