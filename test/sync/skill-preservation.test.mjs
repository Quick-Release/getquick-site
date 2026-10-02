import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { newSite, readSite } from "../support/generated-site.mjs";

test("generated site hooks exclude imported skills from formatting and linting", async () => {
  const site = await newSite();
  const source = await readSite(site.root, "vite.config.ts");
  const config = runInNewContext(
    source.replace('import { defineConfig } from "vite-plus";', "").replace("export default", ""),
    { defineConfig: (value) => value },
  );
  for (const tool of ["fmt", "lint"]) {
    assert.deepEqual(Array.from(config[tool].ignorePatterns), [
      ".agents/skills/**",
      ".claude/skills/**",
    ]);
  }
});
