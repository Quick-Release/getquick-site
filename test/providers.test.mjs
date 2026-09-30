import assert from "node:assert/strict";
import test from "node:test";
import { createCloudflareClient } from "../src/ops/providers/cloudflare.mjs";
import { createPloiClient } from "../src/ops/providers/ploi.mjs";

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

test("Cloudflare client paginates and scopes zone filters", async () => {
  const urls = [];
  const client = createCloudflareClient({
    token: "secret",
    fetchImplementation: async (url) => {
      urls.push(String(url));
      const page = Number(new URL(url).searchParams.get("page"));
      return jsonResponse({
        success: true,
        result: [{ id: `zone-${page}` }],
        result_info: { total_pages: 2 },
      });
    },
  });

  assert.deepEqual(await client.listZones({ "account.id": "account", name: "example.com" }), [
    { id: "zone-1" },
    { id: "zone-2" },
  ]);
  assert.equal(new URL(urls[0]).searchParams.get("account.id"), "account");
  assert.match(urls[0], /name=example\.com/);
});

test("Cloudflare accounts pagination derives pages from total count", async () => {
  let requests = 0;
  const client = createCloudflareClient({
    token: "secret",
    fetchImplementation: async (url) => {
      requests += 1;
      const page = Number(new URL(url).searchParams.get("page"));
      return jsonResponse({
        success: true,
        result: [{ id: `account-${page}` }],
        result_info: { page, per_page: 50, total_count: 100 },
      });
    },
  });

  assert.deepEqual(await client.listAccounts(), [{ id: "account-1" }, { id: "account-2" }]);
  assert.equal(requests, 2);
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
