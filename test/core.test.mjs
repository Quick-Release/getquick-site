import assert from "node:assert/strict";
import test from "node:test";
import { parseEnv } from "../src/ops/env.mjs";
import { requestJson } from "../src/ops/providers/http.mjs";

test("parses common dotenv quoting, comments, and escapes", () => {
  assert.deepEqual(
    parseEnv(`
PLAIN=value # comment
SINGLE='literal # value' # comment
DOUBLE="line\\nvalue" # comment
EMPTY=
export EXPORTED=yes
`),
    {
      PLAIN: "value",
      SINGLE: "literal # value",
      DOUBLE: "line\nvalue",
      EMPTY: "",
      EXPORTED: "yes",
    },
  );
});

test("non-JSON HTTP errors preserve provider status context", async () => {
  await assert.rejects(
    requestJson("https://example.test", {
      fetchImplementation: async () => new Response("bad gateway", { status: 502 }),
    }),
    /HTTP 502/,
  );
});
