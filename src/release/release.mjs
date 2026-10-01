import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadSiteSettings } from "../manifest/site-settings.mjs";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const BUMP_KINDS = new Set(["major", "minor", "fix", "patch"]);

// Command → [usage, the options it accepts].
const RELEASE_COMMANDS = new Map([
  ["version check", ["gq version check [version]", []]],
  ["version sync", ["gq version sync [version]", []]],
  ["release prepare", ["gq release prepare [version]", []]],
  ["release tag", ["gq release tag [version]", []]],
  ["release push", ["gq release push <major|minor|fix>", []]],
]);

export const RELEASE_USAGE = [...RELEASE_COMMANDS.values()].map(([usage]) => usage);

export function isReleaseCommand(command) {
  return command[0] === "version" || command[0] === "release";
}

// Resolves a release command's name and the options it accepts, checking its
// shape (and push's bump kind) before any project is loaded, so the CLI can
// validate its options like any other command's.
export function releaseCommandOptions(parsed) {
  const [group, action, argument, ...extra] = parsed.command;
  const name = `${group} ${action ?? ""}`.trim();
  const entry = RELEASE_COMMANDS.get(name);
  if (!entry || extra.length > 0) {
    throw new Error(`Unknown command: ${parsed.command.join(" ")}. Run gq --help.`);
  }
  const [usage, allowedOptions] = entry;
  if (name === "release push" && !BUMP_KINDS.has(argument ?? "")) {
    throw new Error(`Usage: ${usage}`);
  }
  return { command: name, allowedOptions };
}

// Runs a command that releaseCommandOptions() has already accepted.
export async function runReleaseCommand({ parsed, context, env, exec, io }) {
  const argument = parsed.command[2];
  const release = createRelease({
    config: await loadSiteSettings(context),
    root: context.projectRoot,
    env,
    exec,
    io,
  });
  const command = parsed.command.slice(0, 2).join(" ");

  if (command === "release push") {
    await release.push(argument);
    return;
  }
  if (command === "release tag") {
    await release.tag(argument || (await release.readVersion()));
    return;
  }

  const version = argument || (await release.readVersion());
  assertVersion(version);
  if (command === "release prepare") {
    await release.writeVersion(version);
  }
  if (command !== "version check") {
    await release.sync(version);
  }
  await release.check(version);
  if (command === "release prepare") {
    io.out(
      `Prepared release ${version}. Commit the synced files, then run: gq release tag ${version}`,
    );
  }
}

function assertVersion(version) {
  if (!SEMVER.test(version)) {
    throw new Error(`Expected a semver version, received "${version}".`);
  }
}

function createRelease({ config, root, env, exec, io }) {
  const at = (path) => join(root, path);
  const readJson = async (path) => JSON.parse(await readFile(at(path), "utf8"));
  const writeJson = (path, data) => writeFile(at(path), `${JSON.stringify(data, null, 2)}\n`);

  // A command whose output the user watches (checks, commits, pushes).
  async function runCommand(command, args, { cwd, env: commandEnv = env } = {}) {
    const { code } = await exec(command, args, {
      cwd: cwd ? at(cwd) : root,
      env: commandEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    if (code !== 0) {
      throw new Error(`${[command, ...args].join(" ")} exited with code ${code}.`);
    }
  }

  // A git query whose output the release reads.
  async function git(args) {
    const { code, stdout, stderr } = await exec("git", args, { cwd: root, env });
    if (code !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || `exit code ${code}`}`);
    }
    return stdout.trim();
  }

  async function readVersion() {
    return (await readFile(at(config.versionFile), "utf8")).trim();
  }

  async function writeVersion(version) {
    await writeFile(at(config.versionFile), `${version}\n`);
  }

  async function sync(version) {
    for (const path of config.jsonFiles) {
      const data = await readJson(path);
      data.version = version;
      await writeJson(path, data);
    }

    for (const file of config.textFiles) {
      let content = await readFile(at(file.path), "utf8");
      for (const { regexp, replacement } of file.patterns) {
        if (!regexp.test(content)) {
          throw new Error(`${file.path} is missing expected version pattern ${regexp}.`);
        }
        content = content.replace(regexp, () => replacement(version));
      }
      await writeFile(at(file.path), content);
    }

    io.out(`Synced project version ${version}.`);
  }

  async function check(version) {
    const mismatches = [];

    for (const path of config.jsonFiles) {
      const data = await readJson(path);
      if (data.version !== version) mismatches.push(`${path}: ${data.version || "[missing]"}`);
    }

    for (const file of config.textFiles) {
      const content = await readFile(at(file.path), "utf8");
      for (const pattern of file.patterns) {
        const expected = pattern.replacement(version);
        if (!content.includes(expected)) mismatches.push(`${file.path}: missing "${expected}"`);
      }
    }

    if (mismatches.length > 0) {
      throw new Error(
        `Version drift detected for ${version}:\n${mismatches.map((line) => `  - ${line}`).join("\n")}`,
      );
    }

    io.out(`All project packages are synced at ${version}.`);
  }

  async function tag(version) {
    assertVersion(version);
    await check(version);
    if (await git(["status", "--porcelain"])) {
      throw new Error("Release tagging requires a clean working tree.");
    }
    await createTag(version);
  }

  async function createTag(version) {
    const name = `v${version}`;
    await runCommand("git", ["tag", "-a", name, "-m", `Release ${name}`]);
    io.out(`Created ${name}. Push it with: git push origin ${name}`);
  }

  async function push(kind) {
    const currentVersion = await readVersion();
    assertVersion(currentVersion);

    const nextVersion = bumpVersion(currentVersion, kind);
    if (await git(["tag", "--list", `v${nextVersion}`])) {
      throw new Error(`Release tag v${nextVersion} already exists.`);
    }
    await writeVersion(nextVersion);
    await sync(nextVersion);
    await updateChangelog(nextVersion);
    await check(nextVersion);
    await runChecks();
    await commit(nextVersion);
    await pushRelease(nextVersion);
    io.out(`Pushed ${kind === "patch" ? "fix" : kind} release ${nextVersion}.`);
  }

  async function updateChangelog(version) {
    const previousTag = (
      await git(["tag", "--merged", "HEAD", "--list", "v[0-9]*", "--sort=-v:refname"])
    )
      .split(/\r?\n/)
      .map((name) => name.trim())
      .find((name) => /^v\d+\.\d+\.\d+/.test(name));
    const log = await git([
      "log",
      previousTag ? `${previousTag}..HEAD` : "HEAD",
      "--pretty=format:%h %s",
    ]);
    const commits = log ? log.split(/\r?\n/) : [];
    const previousRelease = previousTag || "initial release";
    const lines = [
      `## v${version} - ${new Date().toISOString().slice(0, 10)}`,
      "",
      `Previous release: ${previousRelease}`,
      "",
      ...(commits.length
        ? commits.map((message) => `- ${message}`)
        : ["- No commit messages recorded."]),
      "",
    ];

    let changelog;
    try {
      changelog = await readFile(at(config.changelogPath), "utf8");
    } catch {
      changelog = "# Changelog\n";
    }
    const normalized = changelog.trimEnd();
    const next = normalized.startsWith("# Changelog")
      ? normalized.replace(/^# Changelog\s*/, `# Changelog\n\n${lines.join("\n")}\n`)
      : `# Changelog\n\n${lines.join("\n")}\n${normalized}`;

    await writeFile(at(config.changelogPath), `${next.trimEnd()}\n`);
    io.out(`Updated ${config.changelogPath} from ${previousRelease} to v${version}.`);
  }

  async function runChecks() {
    for (const check of config.checks) {
      await runCommand(check.cmd, check.args, {
        cwd: check.cwd,
        env: check.env ? { ...env, ...check.env } : env,
      });
    }
  }

  async function commit(version) {
    await runCommand("git", ["add", ...config.releasePaths]);
    if (!(await git(["diff", "--cached", "--name-only"]))) {
      throw new Error("No release changes were staged.");
    }
    await runCommand("git", ["commit", "-m", `Release v${version}`]);
    await createTag(version);
  }

  async function pushRelease(version) {
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch || branch === "HEAD") {
      throw new Error("Cannot push release from a detached HEAD.");
    }
    await runCommand("git", ["push", "origin", branch]);
    await runCommand("git", ["push", "origin", `v${version}`]);
  }

  return { readVersion, writeVersion, sync, check, tag, push };
}

function bumpVersion(version, kind) {
  const [major, minor, patch] = version
    .split(/[+-]/)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
