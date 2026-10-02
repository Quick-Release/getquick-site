// Cloudflare inspection command contracts through run(): zone selection and
// byte-for-byte DNS output, including escaping terminal control characters.
import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureSite, recordingFetch } from "../support/fixture-site.mjs";

const CLOUDFLARE_TOKEN = { CLOUDFLARE_API_TOKEN: "cloudflare-secret" };

test("cloudflare dns list resolves the zone by name and escapes control characters", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(({ url }) =>
    new URL(url).pathname === "/client/v4/zones"
      ? { success: true, result: [{ id: "zone-1" }], result_info: { total_pages: 1 } }
      : {
          success: true,
          result: [
            {
              id: "r1",
              type: "A",
              name: "example.test",
              content: "203.0.113.10",
              proxied: true,
              ttl: 1,
            },
            {
              id: "r2",
              type: "TXT",
              name: "_x.example.test",
              content: "safe\u001b]8;;x\u0007",
              proxied: false,
              ttl: 300,
            },
          ],
          result_info: { total_pages: 1 },
        },
  );

  const result = await fixture.run(["cloudflare", "dns", "list"], { env: CLOUDFLARE_TOKEN, fetch });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    "ID  TYPE  NAME             CONTENT                PROXIED  TTL\n" +
      "--  ----  ---------------  ---------------------  -------  ---\n" +
      "r1  A     example.test     203.0.113.10           true     1  \n" +
      "r2  TXT   _x.example.test  safe\\u001b]8;;x\\u0007  false    300\n",
  );
  assert.deepEqual(
    fetch.requests.map(({ url, headers }) => [url, headers.Authorization]),
    [
      [
        "https://api.cloudflare.com/client/v4/zones?name=example.test&account.id=account-1&page=1&per_page=50",
        "Bearer cloudflare-secret",
      ],
      [
        "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records?page=1&per_page=50",
        "Bearer cloudflare-secret",
      ],
    ],
  );
});

test("cloudflare zone show refuses an ambiguous zone name", async () => {
  const fixture = await createFixtureSite();
  const fetch = recordingFetch(() => ({
    success: true,
    result: [{ id: "a" }, { id: "b" }],
    result_info: { total_pages: 1 },
  }));

  const result = await fixture.run(["cloudflare", "zone", "show"], {
    env: CLOUDFLARE_TOKEN,
    fetch,
  });

  assert.equal(result.code, 1);
  assert.equal(
    result.stderr,
    "gq: Expected exactly one matching Cloudflare zone, found 2. Configure cloudflare.zoneId or pass --zone.\n",
  );
});
