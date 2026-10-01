// Pure migrations of gq.ops.json, one per schema version: `MIGRATIONS[n]`
// takes a vN manifest to vN+1. Each returns the new manifest and a warning
// for every key it drops, so nothing disappears silently.
import { MANIFEST_FILENAME, SCHEMA_URL, VARIANTS } from "./schema.mjs";

// What a migration needs but can't derive from the manifest; `gq sync
// --check` still reports the migration as pending.
export class MigrationInputError extends Error {}

// Keys v0 manifests carried for flows gq no longer has, with why each went.
const DROPPED_V0_KEYS = [
  ["credentials", "gq no longer writes provider credentials to .env"],
  ["github.environment", "gq no longer syncs GitHub Actions secrets and variables"],
  ["github.secrets", "gq no longer syncs GitHub Actions secrets and variables"],
  ["github.variables", "gq no longer syncs GitHub Actions secrets and variables"],
];

export const MIGRATIONS = [
  // v0, today's unvalidated shape, to v1. v0 never recorded the variant, and
  // gq doesn't guess it: it comes from the manifest or `variant`.
  function v0ToV1(v0, { variant = v0.variant } = {}) {
    if (!VARIANTS.includes(variant)) {
      throw new MigrationInputError(
        `Migrating ${MANIFEST_FILENAME} to schema v1 needs the site's variant: ` +
          `pass ${VARIANTS.map((name) => `--variant ${name}`).join(" or ")}.`,
      );
    }
    const rest = structuredClone(v0);
    for (const key of ["$schema", "schemaVersion", "project", "variant"]) delete rest[key];
    const warnings = [];
    for (const [path, reason] of DROPPED_V0_KEYS) {
      if (deleteAt(rest, path)) warnings.push(`dropped ${path}: ${reason}.`);
    }
    if (isEmptyObject(rest.github)) delete rest.github;

    return {
      manifest: { $schema: SCHEMA_URL, schemaVersion: 1, project: v0.project, variant, ...rest },
      warnings,
    };
  },
];

// Deletes the dotted `path` from `object`; returns whether it was there.
function deleteAt(object, path) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((value, key) => value?.[key], object);
  if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, last)) return false;
  delete parent[last];
  return true;
}

function isEmptyObject(value) {
  return value && typeof value === "object" && Object.keys(value).length === 0;
}
