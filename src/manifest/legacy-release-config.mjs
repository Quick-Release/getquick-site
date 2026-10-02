// Folding a site's release config module (shop-devtools.config.mjs) into its
// v1 gq.ops.json. `gq sync --manifest` reads the module, folds it with
// `foldReleaseConfig` and removes it. Only what differs from the variant's
// defaults is kept, as additions; a default the module left out is named,
// since gq now adds it. What gq.ops.json can't express is refused by name.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { checkRequirements, describeCheck } from "../workspace/verify.mjs";
import { MANIFEST_FILENAME } from "./schema.mjs";
import { hasReleaseConfig, RELEASE_CONFIG_FILENAME, VARIANT_DEFAULTS } from "./site-settings.mjs";

export { RELEASE_CONFIG_FILENAME };

// The release config module's export in `root`, or null when there is none.
export async function readReleaseConfig(root) {
  if (!(await hasReleaseConfig(root))) return null;
  const module = await import(pathToFileURL(join(root, RELEASE_CONFIG_FILENAME)).href);
  return module.default ?? module;
}

// Keys a release config could set that gq.ops.json has no place for, with
// whether (and why) each is refused when set.
const FIXED = {
  versionFile: ["VERSION", "every site's version file is VERSION"],
  changelogPath: ["CHANGELOG.md", "every site's changelog is CHANGELOG.md"],
};
const UNSUPPORTED = {
  docsChangelogPath: "the docs changelog page was dropped with shop-devtools",
  composer: "gq no longer pins Composer packages to the release version",
  deploys: "releases deploy from Cloudflare CI",
};
const FOLDED = ["jsonFiles", "textFiles", "releasePaths", "checks", "doctor"];

// Placeholders the replacement functions are called with to read them as
// fixed text around the version.
const SENTINELS = ["\u0000gq-version-a\u0000", "\u0000gq-version-b\u0000"];

// Returns the manifest with `config`'s additions folded in, and a warning for
// each key dropped or default added. Pure; throws, naming every problem, when
// `config` sets something gq.ops.json can't express.
export function foldReleaseConfig(manifest, config) {
  const problems = [];
  const warnings = [];
  for (const [key, value] of Object.entries(config)) {
    if (key === "releaseBranch") {
      warnings.push("dropped releaseBranch: gq releases the branch that is checked out.");
    } else if (FIXED[key]) {
      const [fixed, reason] = FIXED[key];
      if (value !== fixed) problems.push(`${key} is ${JSON.stringify(value)}, but ${reason}`);
    } else if (UNSUPPORTED[key]) {
      if (isSet(value)) problems.push(`${key} is not supported: ${UNSUPPORTED[key]}`);
    } else if (!FOLDED.includes(key)) problems.push(`${key} is not a release config key`);
  }
  for (const key of Object.keys(config.doctor ?? {})) {
    if (key !== "requiredFiles") problems.push(`doctor.${key} is not a release config key`);
  }
  const textFiles = (config.textFiles ?? []).map((file, index) =>
    textFileToJson(file, `textFiles[${index}]`, problems),
  );
  if (problems.length > 0) {
    throw new Error(
      `Can't fold ${RELEASE_CONFIG_FILENAME} into ${MANIFEST_FILENAME}: ${problems.join("; ")}. ` +
        "Change it, then run gq sync --manifest again.",
    );
  }

  const defaults = VARIANT_DEFAULTS[manifest.variant];
  const omitted = (kind, values) => {
    for (const value of values) {
      warnings.push(`omits the ${manifest.variant} default ${kind} ${value}, which gq now adds.`);
    }
  };
  const release = { ...manifest.release };
  const verify = { ...manifest.verify };
  const doctor = { ...manifest.doctor };

  const jsonFiles = config.jsonFiles ?? [];
  omitted("version file", without(defaults.release.jsonFiles, jsonFiles));
  release.jsonFiles = additions(release.jsonFiles, defaults.release.jsonFiles, jsonFiles);
  release.textFiles = additions(release.textFiles, defaults.release.textFiles, textFiles);
  // The module is removed, so the release commit no longer stages it.
  const paths = (config.releasePaths ?? []).filter((path) => path !== RELEASE_CONFIG_FILENAME);
  omitted("release path", without(defaults.release.paths, paths));
  release.paths = additions(release.paths, defaults.release.paths, paths);

  const checks = (config.checks ?? []).map(checkToJson);
  omitted(
    "check",
    without(defaults.verify.checks, checks, sameCheck).map((check) => `"${describeCheck(check)}"`),
  );
  // Additions run after the defaults; `gq verify` stops at the first failure,
  // so a check that ran before a default is named.
  const isDefault = (check) => defaults.verify.checks.some((other) => sameCheck(other, check));
  const lastDefault = checks.findLastIndex(isDefault);
  for (const check of checks.slice(0, Math.max(lastDefault, 0))) {
    if (!isDefault(check)) {
      warnings.push(
        `runs "${describeCheck(check)}" before the ${manifest.variant} default checks; ` +
          "gq now runs it after them.",
      );
    }
  }
  verify.checks = additions(verify.checks, defaults.verify.checks, checks, sameCheck);

  const requiredFiles = { ...doctor.requiredFiles };
  const required = config.doctor?.requiredFiles ?? {};
  const omittedFiles = [];
  for (const [app, files] of Object.entries(defaults.doctor.requiredFiles)) {
    omittedFiles.push(...without(files, required[app] ?? []).map((file) => `${app}/${file}`));
  }
  omitted("required file", omittedFiles);
  for (const [app, files] of Object.entries(required)) {
    const kept = additions(requiredFiles[app], defaults.doctor.requiredFiles[app] ?? [], files);
    if (kept) requiredFiles[app] = kept;
  }
  doctor.requiredFiles = Object.keys(requiredFiles).length > 0 ? requiredFiles : undefined;

  const folded = { ...manifest };
  for (const [key, block] of Object.entries({ release, verify, doctor })) {
    const defined = Object.entries(block).filter(([, value]) => value !== undefined);
    if (defined.length > 0) folded[key] = Object.fromEntries(defined);
  }
  return { manifest: folded, warnings };
}

// A text file's { regexp: RegExp, replacement: (version) => string } patterns
// as JSON: the regexp's source and flags, and the replacement as fixed text
// with `{version}` where the version goes.
function textFileToJson({ path, patterns }, at, problems) {
  return {
    path,
    patterns: (patterns ?? []).map(({ regexp, replacement }, index) => {
      const pattern = `${at}.patterns[${index}]`;
      if (!(regexp instanceof RegExp)) {
        problems.push(`${pattern}.regexp must be a regular expression`);
      }
      const template = replacementTemplate(replacement);
      if (template === null) {
        problems.push(`${pattern}.replacement must return the version inside fixed text`);
      }
      return {
        regexp: regexp?.source,
        ...(regexp?.flags ? { flags: regexp.flags } : {}),
        replacement: template,
      };
    }),
  };
}

function replacementTemplate(replacement) {
  if (typeof replacement !== "function") return null;
  try {
    const [first, second] = SENTINELS.map((sentinel) => {
      const text = replacement(sentinel);
      return typeof text === "string" && text.includes(sentinel)
        ? text.replaceAll(sentinel, "{version}")
        : null;
    });
    return first !== null && first === second ? first : null;
  } catch {
    return null;
  }
}

// A check as gq.ops.json writes it: an object, without empty `args`.
function checkToJson(entry) {
  const check = typeof entry === "string" ? { cmd: entry } : { ...entry };
  if (Array.isArray(check.args) && check.args.length === 0) delete check.args;
  return check;
}

// Whether two checks run the same way.
function sameCheck(a, b) {
  const canonical = (check) =>
    JSON.stringify([
      check.cmd,
      check.args ?? [],
      check.cwd ?? null,
      Object.entries(check.env ?? {}).sort(),
      checkRequirements(check),
    ]);
  return canonical(a) === canonical(b);
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// `values` not among `defaults` or the `existing` additions, appended to
// them; undefined when there are none.
function additions(existing = [], defaults, values, same = sameValue) {
  const kept = [...existing];
  for (const value of values) {
    if (![...defaults, ...kept].some((other) => same(other, value))) kept.push(value);
  }
  return kept.length > 0 ? kept : undefined;
}

// `defaults` missing from `values`.
function without(defaults, values, same = sameValue) {
  return defaults.filter((value) => !values.some((other) => same(other, value)));
}

function isSet(value) {
  if (value === undefined || value === null) return false;
  return !Array.isArray(value) || value.length > 0;
}
