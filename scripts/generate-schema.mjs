// Writes schema/gq.ops.schema.json, the JSON Schema editors load through a
// site's gq.ops.json `$schema`, from the zod schema in src/manifest/schema.mjs.
// test/manifest.test.mjs fails when the published copy is stale.
import { writeFileSync } from "node:fs";

import { manifestJsonSchema } from "../src/manifest/schema.mjs";

const target = new URL("../schema/gq.ops.schema.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`);
