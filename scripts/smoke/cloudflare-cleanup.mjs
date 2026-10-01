#!/usr/bin/env node
// Teardown helpers for the gq-smoke throwaway site (scripts/smoke/gq-smoke-down.sh).
// Run from the site root through `gq sigillo run <environment> --`, which
// injects the credentials; values are never printed.
//
//   node cloudflare-cleanup.mjs empty-bucket <bucket> <access key var> <secret var>
//       Deletes every object in <bucket> with that bucket's own scoped R2 key
//       (Sigillo `staging`), which can't reach any other bucket.
//   node cloudflare-cleanup.mjs tokens [--delete]
//       Lists, or deletes, the account tokens named "GETQUICK <PROJECT> …"
//       with CLOUDFLARE_TOKEN_MANAGER_API_TOKEN (Sigillo `ops`).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const ops = JSON.parse(readFileSync(join(process.cwd(), "gq.ops.json"), "utf8"));
const accountId = ops.cloudflare?.accountId;
if (!accountId) fail("gq.ops.json cloudflare.accountId is required.");

const [command, ...args] = process.argv.slice(2);
if (command === "empty-bucket") await emptyBucket(...args);
else if (command === "tokens") await tokens(args.includes("--delete"));
else
  fail(
    "Usage: cloudflare-cleanup.mjs empty-bucket <bucket> <key var> <secret var> | tokens [--delete]",
  );

async function emptyBucket(bucket, keyVariable, secretVariable) {
  if (!bucket || !keyVariable || !secretVariable)
    fail("empty-bucket needs <bucket> <key var> <secret var>.");
  const accessKeyId = process.env[keyVariable];
  const secretAccessKey = process.env[secretVariable];
  if (!accessKeyId || !secretAccessKey)
    fail(`${keyVariable}/${secretVariable} are missing from the secret store.`);
  const client = new (awsClient())({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;

  let deleted = 0;
  let continuation;
  do {
    const query = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
    if (continuation) query.set("continuation-token", continuation);
    const response = await client.fetch(`${base}?${query}`);
    if (response.status === 404) {
      console.log(`${bucket}: not found (already deleted).`);
      return;
    }
    const body = await response.text();
    if (!response.ok) fail(`Listing ${bucket} failed: ${response.status} ${body.slice(0, 300)}`);
    const keys = [...body.matchAll(/<Key>([\s\S]*?)<\/Key>/gu)].map((match) => decodeXml(match[1]));
    continuation = /<IsTruncated>true<\/IsTruncated>/u.test(body)
      ? decodeXml(
          body.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/u)?.[1] ?? "",
        )
      : undefined;
    for (let index = 0; index < keys.length; index += 8) {
      await Promise.all(
        keys.slice(index, index + 8).map(async (key) => {
          const path = key.split("/").map(encodeURIComponent).join("/");
          const deletion = await client.fetch(`${base}/${path}`, { method: "DELETE" });
          if (!deletion.ok && deletion.status !== 404)
            fail(`Deleting ${bucket}/${key} failed: ${deletion.status}`);
        }),
      );
      deleted += Math.min(8, keys.length - index);
    }
  } while (continuation);
  console.log(`${bucket}: deleted ${deleted} object(s); the bucket is empty.`);
}

async function tokens(remove) {
  const token = process.env.CLOUDFLARE_TOKEN_MANAGER_API_TOKEN;
  if (!token) fail("CLOUDFLARE_TOKEN_MANAGER_API_TOKEN is missing from the secret store.");
  const prefix = `GETQUICK ${ops.project.toUpperCase()} `;
  const request = async (method, path) => {
    const response = await fetch(`${API_ORIGIN}/accounts/${accountId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      fail(
        `Cloudflare ${method} ${path} failed: ${data.errors?.map((error) => error.message).join("; ") || response.status}`,
      );
    }
    return data;
  };

  const found = [];
  for (let page = 1; ; page += 1) {
    const data = await request("GET", `/tokens?per_page=50&page=${page}`);
    found.push(...data.result.filter((entry) => entry.name.startsWith(prefix)));
    if (page >= (data.result_info?.total_pages ?? 1)) break;
  }
  if (found.length === 0) {
    console.log(`No "${prefix}…" tokens left.`);
    return;
  }
  for (const entry of found) {
    if (remove) await request("DELETE", `/tokens/${entry.id}`);
    console.log(`${remove ? "deleted" : "found"}  ${entry.name}`);
  }
}

// aws4fetch is a dependency of the site's @getquick/site, not of the site.
function awsClient() {
  const site = createRequire(join(process.cwd(), "package.json"));
  return createRequire(site.resolve("@getquick/site/package.json"))("aws4fetch").AwsClient;
}

function decodeXml(text) {
  return text
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
