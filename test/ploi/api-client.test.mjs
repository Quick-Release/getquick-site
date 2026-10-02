import assert from "node:assert/strict";
import test from "node:test";
import { createPloiClient } from "../../src/ploi/api-client.mjs";

test("Ploi client follows trusted pagination links", async () => {
  const urls = [];
  const client = createPloiClient({
    token: "secret",
    fetchImplementation: async (url, options) => {
      urls.push(String(url));
      assert.equal(options.headers.Authorization, "Bearer secret");
      const page = new URL(url).searchParams.get("page");
      return jsonResponse(
        page === "2"
          ? { data: [{ id: 2 }], links: { next: null } }
          : {
              data: [{ id: 1 }],
              links: { next: "https://ploi.io/api/servers?page=2" },
            },
      );
    },
  });

  assert.deepEqual(await client.listServers(), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(urls, ["https://ploi.io/api/servers", "https://ploi.io/api/servers?page=2"]);
});

test("Ploi client rejects pagination links outside the API", async () => {
  const client = createPloiClient({
    token: "secret",
    fetchImplementation: async () =>
      jsonResponse({
        data: [],
        links: { next: "https://attacker.example/steal" },
      }),
  });

  await assert.rejects(client.listServers(), /unexpected URL/);
});

test("Ploi client rejects cyclic pagination", async () => {
  const client = createPloiClient({
    token: "secret",
    fetchImplementation: async () =>
      jsonResponse({
        data: [],
        links: { next: "https://ploi.io/api/servers" },
      }),
  });

  await assert.rejects(client.listServers(), /repeated URL/);
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
