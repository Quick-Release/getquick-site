import { requestJson } from "./http.mjs";

const API_BASE_URL = "https://api.cloudflare.com/client/v4";

export function createCloudflareClient(options) {
  const token = required(options.token, "CLOUDFLARE_API_TOKEN");
  const fetchImplementation = options.fetchImplementation;

  async function request(path, query = {}) {
    const url = toApiUrl(path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }

    const payload = await requestJson(url, {
      fetchImplementation,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      errorMessage(response, data) {
        return (
          data.errors
            ?.map((error) => error.message)
            .filter(Boolean)
            .join("; ") || `Cloudflare request failed with HTTP ${response.status}.`
        );
      },
    });

    if (payload.success === false) {
      throw new Error(
        payload.errors
          ?.map((error) => error.message)
          .filter(Boolean)
          .join("; ") || "Cloudflare reported an unsuccessful request.",
      );
    }
    return payload;
  }

  async function list(path, query = {}) {
    const items = [];
    let page = 1;

    while (true) {
      if (page > 100) throw new Error("Cloudflare pagination exceeded 100 pages.");
      const payload = await request(path, {
        ...query,
        page: String(page),
        per_page: "50",
      });
      if (Array.isArray(payload.result)) items.push(...payload.result);
      const pageInfo = payload.result_info || {};
      const perPage = Number(pageInfo.per_page) || 50;
      const totalPages =
        Number(pageInfo.total_pages) ||
        Math.max(1, Math.ceil((Number(pageInfo.total_count) || items.length) / perPage));
      if (page >= totalPages) return items;
      page += 1;
    }
  }

  return {
    async listAccounts() {
      return list("/accounts");
    },
    async listZones(filters = {}) {
      return list("/zones", filters);
    },
    async getZone(zoneId) {
      return unwrap(await request(`/zones/${encodeURIComponent(zoneId)}`));
    },
    async listDnsRecords(zoneId, filters = {}) {
      return list(`/zones/${encodeURIComponent(zoneId)}/dns_records`, filters);
    },
  };
}

function toApiUrl(path) {
  const url = new URL(`${API_BASE_URL}/${path.replace(/^\/+/, "")}`);
  if (url.origin !== new URL(API_BASE_URL).origin || !url.pathname.startsWith("/client/v4/")) {
    throw new Error("Cloudflare request resolved outside the expected API.");
  }
  return url;
}

function unwrap(payload) {
  return payload.result ?? payload;
}

function required(value, environmentName) {
  if (!value?.trim()) throw new Error(`${environmentName} is required.`);
  return value.trim();
}
