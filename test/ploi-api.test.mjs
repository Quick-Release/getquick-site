import assert from "node:assert/strict";
import test from "node:test";
import { PLOI_ENDPOINTS, ploiCatalog } from "../src/ops/providers/ploi-endpoints.mjs";
import { createPloiClient } from "../src/ops/providers/ploi.mjs";

test("Ploi catalog covers every researched API operation", () => {
  assert.equal(PLOI_ENDPOINTS.length, 225);
  assert.equal(new Set(PLOI_ENDPOINTS.map(({ id }) => id)).size, 225);
  assert.deepEqual(ploiCatalog.get("sites.get-site"), {
    id: "sites.get-site",
    method: "GET",
    path: "/api/servers/{server}/sites/{site}",
    sourceUrl: "https://developers.ploi.io/sites/get-site",
    summary: "Get a single site from a server.",
  });
  assert.deepEqual(ploiCatalog.get("getting-started.teapot").acceptedStatuses, [418]);
});

test("Ploi endpoint executor encodes path and query values and sends JSON", async () => {
  let recorded;
  const client = createPloiClient({
    token: "secret",
    fetchImplementation: async (url, options) => {
      recorded = { url: String(url), options };
      return jsonResponse({ data: { id: 9 } });
    },
  });

  assert.deepEqual(
    await client.executeEndpoint(
      { method: "PATCH", path: "/api/servers/{server}/sites/{site}" },
      {
        pathParameters: { server: "server/one", site: "site two" },
        query: { include: ["repository", "status"] },
        body: { web_directory: "/dist" },
      },
    ),
    { data: { id: 9 } },
  );

  const url = new URL(recorded.url);
  assert.equal(url.pathname, "/api/servers/server%2Fone/sites/site%20two");
  assert.deepEqual(url.searchParams.getAll("include"), ["repository", "status"]);
  assert.equal(recorded.options.method, "PATCH");
  assert.equal(recorded.options.headers.Authorization, "Bearer secret");
  assert.equal(recorded.options.headers["Content-Type"], "application/json");
  assert.equal(recorded.options.body, '{"web_directory":"/dist"}');
});

test("Ploi teapot operation accepts its documented 418 response", async () => {
  const client = createPloiClient({
    token: "secret",
    fetchImplementation: async () => jsonResponse({ message: "I'm a teapot" }, 418),
  });

  assert.deepEqual(await client.executeEndpoint(ploiCatalog.get("getting-started.teapot")), {
    message: "I'm a teapot",
  });
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
