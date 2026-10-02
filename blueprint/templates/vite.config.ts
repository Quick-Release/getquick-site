import { defineConfig } from "vite-plus";

export default defineConfig({
  // Imported agent skills must remain exact upstream copies, including scripts.
  fmt: { ignorePatterns: [".agents/skills/**", ".claude/skills/**"] },
  lint: { ignorePatterns: [".agents/skills/**", ".claude/skills/**"] },
  // Pre-commit (.vite-hooks/pre-commit): format and lint only what's staged.
  // The full check list runs before every push (.vite-hooks/pre-push), which
  // keeps Cloudflare CI runs — billed per container-second — mostly green.
  staged: {
    "**/*.{js,cjs,mjs,jsx,ts,tsx}": [
      "vp fmt --write --no-error-on-unmatched-pattern",
      "vp lint --no-error-on-unmatched-pattern",
    ],
    "**/*.{json,jsonc,md,mdx,css,scss,html}": "vp fmt --write --no-error-on-unmatched-pattern",
  },
});
