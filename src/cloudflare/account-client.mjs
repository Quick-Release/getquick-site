// Account-scoped Cloudflare API client for the provisioning commands
// (Lombardi's cloudflare-deploy-token.mjs `createCloudflareClient`): resolves
// to the response's `result`, and fails with Cloudflare's own error messages.
// The read-only inspection-client.mjs stays beside it; their scopes and
// behavior remain distinct.
const API_ORIGIN = "https://api.cloudflare.com/client/v4";

// One authenticated JSON request under the account; fails with `label` and
// Cloudflare's own error messages (or the HTTP status). `allowNotFound`
// resolves a 404 to null.
async function accountRequest(
  { token, accountId, fetch, label },
  method,
  path,
  body,
  { allowNotFound = false } = {},
) {
  const response = await fetch(`${API_ORIGIN}/accounts/${accountId}${path}`, {
    method,
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (allowNotFound && response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const detail = data.errors?.map((error) => error.message).join("; ") || response.status;
    throw new Error(`${label} ${method} ${path} failed: ${detail}`);
  }
  return data;
}

export function createCloudflareAccountClient({ token, accountId, fetch }) {
  const options = { token, accountId, fetch, label: "Cloudflare" };
  return async (method, path, body) => (await accountRequest(options, method, path, body)).result;
}

// Cloudflare Artifacts (namespaces, repositories and repo-scoped git tokens),
// Lombardi's scripts/lib/artifacts.mjs. Git itself only accepts repo-scoped
// tokens, never Cloudflare API tokens.
export function createArtifactsClient({ accountId, token, fetch }) {
  const options = { token, accountId, fetch, label: "Artifacts" };
  async function request(method, path, body, requestOptions) {
    const data = await accountRequest(options, method, `/artifacts${path}`, body, requestOptions);
    return data === null ? null : (data.result ?? data);
  }

  return {
    async ensureRepository(namespace, name, { defaultBranch = "main" } = {}) {
      const existing = await request("GET", `/namespaces/${namespace}/repos/${name}`, undefined, {
        allowNotFound: true,
      });
      if (existing) return existing;
      const namespaces = await request("GET", "/namespaces");
      const list = Array.isArray(namespaces) ? namespaces : (namespaces.namespaces ?? []);
      if (!list.some((entry) => (entry.namespace ?? entry.name) === namespace)) {
        await request("POST", "/namespaces", { namespace });
      }
      return request("POST", `/namespaces/${namespace}/repos`, {
        name,
        default_branch: defaultBranch,
        read_only: false,
      });
    },
    // Short-lived token for one git operation (default: write, 1 hour).
    async createGitToken(namespace, repo, { scope = "write", ttl = 3600 } = {}) {
      const result = await request("POST", `/namespaces/${namespace}/tokens`, { repo, scope, ttl });
      return result.plaintext;
    },
  };
}

// The Artifacts git remote of gq.ops.json `artifacts` in `accountId`.
export function artifactsRemoteUrl({ accountId, namespace, repo }) {
  return `https://${accountId}.artifacts.cloudflare.net/git/${namespace}/${repo}.git`;
}
