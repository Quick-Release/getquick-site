import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    sourcemap: true,
  },
  fmt: {
    ignorePatterns: ["dist/**", ".astro/**", "node_modules/**"],
    singleQuote: false,
    semi: true,
  },
  lint: {
    ignorePatterns: ["dist/**", ".astro/**", "node_modules/**"],
  },
});
