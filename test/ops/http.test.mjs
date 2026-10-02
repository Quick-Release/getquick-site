import assert from "node:assert/strict";
import test from "node:test";
import { requestJson } from "../../src/ops/providers/http.mjs";

test("non-JSON HTTP errors preserve provider status context", async () => {
  await assert.rejects(
    requestJson("https://example.test", {
      fetchImplementation: async () => new Response("bad gateway", { status: 502 }),
    }),
    /HTTP 502/,
  );
});
