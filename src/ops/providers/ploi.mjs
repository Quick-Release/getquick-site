import { requestJson } from "./http.mjs";
import { VERSION } from "../../version.mjs";

const API_BASE_URL = "https://ploi.io/api";
const MAX_PAGES = 100;

export function createPloiClient(options) {
  const token = required(options.token, "PLOI_API_TOKEN");
  const fetchImplementation = options.fetchImplementation;

  async function request(path, options = {}) {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    return requestJson(withQuery(toApiUrl(path), options.query), {
      fetchImplementation,
      method: options.method,
      body,
      acceptedStatuses: options.acceptedStatuses,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": `getquick-site/${VERSION}`,
        ...(body === undefined && (!options.method || options.method === "GET")
          ? {}
          : { "Content-Type": "application/json" }),
      },
      errorMessage(response, payload) {
        return payload.message || `Ploi request failed with HTTP ${response.status}.`;
      },
    });
  }

  async function list(path, options = {}) {
    const items = [];
    const visited = new Set();
    let next = withQuery(toApiUrl(path), options.query);

    while (next) {
      if (visited.size >= (options.maxPages || MAX_PAGES)) {
        throw new Error(`Ploi pagination exceeded ${options.maxPages || MAX_PAGES} pages.`);
      }
      if (visited.has(next)) throw new Error("Ploi pagination returned a repeated URL.");
      visited.add(next);

      const payload = await request(next);
      if (!Array.isArray(payload.data)) {
        throw new Error("Ploi paginated response did not contain a data array.");
      }
      items.push(...payload.data);
      next = payload.links?.next || payload.meta?.next_page_url || null;
      if (next) next = toApiUrl(next);
    }

    return items;
  }

  function prepareEndpoint(endpoint, options = {}) {
    const path = fillPath(endpoint.path, options.pathParameters);
    return {
      method: endpoint.method,
      url: withQuery(toApiUrl(path), options.query),
      body: options.body,
    };
  }

  return {
    prepareEndpoint,
    async executeEndpoint(endpoint, options = {}) {
      const prepared = prepareEndpoint(endpoint, options);
      if (options.paginate) {
        if (endpoint.method !== "GET") {
          throw new Error("Only GET operations can be paginated.");
        }
        return list(prepared.url, { maxPages: options.maxPages });
      }
      return request(prepared.url, {
        method: prepared.method,
        body: prepared.body,
        acceptedStatuses: endpoint.acceptedStatuses,
      });
    },
    async listServers() {
      return list("/servers");
    },
    async getServer(serverId) {
      return unwrap(await request(`/servers/${encodeURIComponent(serverId)}`));
    },
    async listSites(serverId) {
      return list(`/servers/${encodeURIComponent(serverId)}/sites`);
    },
    async getSite(serverId, siteId) {
      return unwrap(
        await request(
          `/servers/${encodeURIComponent(serverId)}/sites/${encodeURIComponent(siteId)}`,
        ),
      );
    },
  };
}

function fillPath(template, values = {}) {
  const placeholders = [...template.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const unused = new Set(Object.keys(values));
  let path = template;

  for (const name of placeholders) {
    const value = values[name];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new Error(`Ploi API operation requires --path ${name}=<value>.`);
    }
    unused.delete(name);
    path = path.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
  }

  if (unused.size > 0) {
    throw new Error(
      `Unknown path parameter${unused.size === 1 ? "" : "s"}: ${[...unused].join(", ")}.`,
    );
  }
  return path;
}

function withQuery(url, query = {}) {
  const result = new URL(url);
  for (const [name, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry !== undefined && entry !== null) {
        result.searchParams.append(name, String(entry));
      }
    }
  }
  return result.href;
}

function toApiUrl(path) {
  let url = /^https?:\/\//.test(path)
    ? new URL(path)
    : path.startsWith("/api/")
      ? new URL(path, new URL(API_BASE_URL).origin)
      : new URL(`${API_BASE_URL}/${path.replace(/^\/+/, "")}`);

  if (url.protocol === "http:" && url.hostname === "ploi.io") {
    url = new URL(url.href);
    url.protocol = "https:";
  }
  if (url.origin !== new URL(API_BASE_URL).origin || !url.pathname.startsWith("/api/")) {
    throw new Error("Ploi returned an unexpected URL outside its API.");
  }
  return url.href;
}

function unwrap(payload) {
  return payload.data ?? payload;
}

function required(value, environmentName) {
  if (!value?.trim()) throw new Error(`${environmentName} is required.`);
  return value.trim();
}
