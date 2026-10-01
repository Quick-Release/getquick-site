import { AwsClient } from "aws4fetch";

// Minimal R2 (S3 API) client for one bucket (Lombardi's scripts/lib/r2.mjs):
// release archives are uploaded here and handed to Ploi as short-lived
// presigned GET URLs, and live database backups are uploaded by Ploi through
// presigned PUT URLs. Requests are signed here and sent through the injected
// `fetch`; S3 signing leaves the payload unsigned, so bodies stream as is.
export function createR2Client({ accountId, bucket, accessKeyId, secretAccessKey, fetch }) {
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are missing; store the bucket's R2 credentials in the secret store first.",
    );
  }
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const origin = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  const url = (key) => `${origin}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const send = async (key, { method, body, headers }) => {
    const signed = await client.sign(url(key), { method, headers });
    return fetch(signed.url, { method, headers: Object.fromEntries(signed.headers), body });
  };
  const presign = async (method, key, expiresSeconds) => {
    const signed = await client.sign(`${url(key)}?X-Amz-Expires=${expiresSeconds}`, {
      method,
      aws: { signQuery: true },
    });
    return signed.url;
  };

  return {
    async exists(key) {
      const response = await send(key, { method: "HEAD" });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`R2 HEAD ${key} failed with ${response.status}`);
      return true;
    },
    async put(key, body, contentType = "application/gzip") {
      const response = await send(key, {
        method: "PUT",
        body,
        headers: { "Content-Type": contentType },
      });
      if (!response.ok) throw new Error(`R2 PUT ${key} failed with ${response.status}`);
    },
    async get(key) {
      const response = await send(key, { method: "GET" });
      if (!response.ok) throw new Error(`R2 GET ${key} failed with ${response.status}`);
      return response;
    },
    presignGet(key, expiresSeconds = 1800) {
      return presign("GET", key, expiresSeconds);
    },
    // Lets a server upload one object (e.g. `curl -T`) without R2 credentials.
    presignPut(key, expiresSeconds = 900) {
      return presign("PUT", key, expiresSeconds);
    },
  };
}

// R2's S3 credentials derive from a Cloudflare API token: the access key ID is
// the token ID and the secret is the SHA-256 of the token value.
export async function s3CredentialsFromToken(tokenId, tokenValue) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tokenValue));
  const secretAccessKey = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { accessKeyId: tokenId, secretAccessKey };
}
