import assert from "node:assert/strict";
import test from "node:test";
import { parseEnv } from "../src/cli/env-files.mjs";

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
