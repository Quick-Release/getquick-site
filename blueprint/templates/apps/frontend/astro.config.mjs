import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { readFileSync } from "node:fs";

// The frontend hostname lives in gq.ops.json (domains.frontend), once the
// site has one.
const ops = JSON.parse(readFileSync(new URL("../../gq.ops.json", import.meta.url), "utf8"));

export default defineConfig({
  site: ops.domains ? `https://${ops.domains.frontend}` : undefined,
  output: "server",
  vite: {
    plugins: [tailwindcss()],
  },
});
