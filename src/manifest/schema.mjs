// gq.ops.json schema v1, the single source of the manifest's shape: commands
// read the manifest it validates, and scripts/generate-schema.mjs writes the
// JSON Schema editors load through `$schema` from it. Every object is strict,
// so a misspelt key fails by name instead of being ignored. The blocks are
// optional (a site not yet provisioned has none of its Ploi or Cloudflare
// IDs); each command still names the keys it needs.
import { z } from "zod";

export const MANIFEST_FILENAME = "gq.ops.json";
export const SCHEMA_VERSION = 1;
export const VARIANTS = ["content", "commerce"];

// Where `$schema` points from a site root, through the site's own install.
export const SCHEMA_URL = "./node_modules/@getquick/site/schema/gq.ops.schema.json";

const name = z.string().trim().min(1);
const hostname = z.string().trim().min(1);

export const manifestSchema = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: z.literal(SCHEMA_VERSION),
    project: name,
    variant: z.enum(VARIANTS),
    domains: z
      .strictObject({ admin: hostname, frontend: hostname, docs: hostname.optional() })
      .optional(),
    sigillo: z
      .strictObject({
        apiUrl: z.string().optional(),
        projectId: z.string().optional(),
        environments: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    ploi: z
      .strictObject({
        serverId: z.string().optional(),
        siteId: z.string().optional(),
        systemUser: z.string().optional(),
        projectRoot: z.string().optional(),
        webDirectory: z.string().optional(),
        database: z.string().optional(),
        envTemplate: z.string().optional(),
        deployScript: z.string().optional(),
      })
      .optional(),
    wordpress: z.strictObject({ plugins: z.array(name) }).optional(),
    releases: z.strictObject({ bucket: z.string(), prefix: z.string().optional() }).optional(),
    media: z.strictObject({ bucket: z.string(), domain: hostname }).optional(),
    backups: z.strictObject({ bucket: z.string(), prefix: z.string().optional() }).optional(),
    local: z
      .strictObject({ adminEmail: z.string().optional(), frontendUrl: z.string().optional() })
      .optional(),
    artifacts: z.strictObject({ namespace: z.string(), repo: z.string() }).optional(),
    ci: z
      .strictObject({
        worker: z.string().optional(),
        backupBucket: z.string().optional(),
        directory: z.string().optional(),
      })
      .optional(),
    cloudflare: z
      .strictObject({
        accountId: z.string().optional(),
        zoneId: z.string().optional(),
        zoneName: z.string().optional(),
      })
      .optional(),
    github: z.strictObject({ repository: z.string().optional() }).optional(),
  })
  .meta({ title: "gq.ops.json", description: "A GETQUICK site's manifest (schema v1)." });

export function manifestJsonSchema() {
  return z.toJSONSchema(manifestSchema);
}
