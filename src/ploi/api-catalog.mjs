export function createPloiCatalog(endpoints) {
  const byId = new Map();

  for (const endpoint of endpoints) {
    validateEndpoint(endpoint);
    if (byId.has(endpoint.id)) {
      throw new Error(`Duplicate Ploi endpoint ID: ${endpoint.id}.`);
    }
    byId.set(endpoint.id, Object.freeze({ ...endpoint }));
  }

  return Object.freeze({
    list({ group, search } = {}) {
      const needle = search?.trim().toLowerCase();
      return [...byId.values()].filter((endpoint) => {
        if (group && endpoint.id.split(".", 1)[0] !== group) return false;
        if (!needle) return true;
        return [endpoint.id, endpoint.method, endpoint.path, endpoint.summary]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(needle));
      });
    },
    get(id) {
      const endpoint = byId.get(id);
      if (!endpoint) {
        throw new Error(`Unknown Ploi API operation: ${id}. Run gq ploi api list.`);
      }
      return endpoint;
    },
  });
}

function validateEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== "object") {
    throw new Error("Ploi endpoint entries must be objects.");
  }
  if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(endpoint.id)) {
    throw new Error(`Invalid Ploi endpoint ID: ${endpoint.id}.`);
  }
  if (!new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]).has(endpoint.method)) {
    throw new Error(`Invalid HTTP method for ${endpoint.id}: ${endpoint.method}.`);
  }
  if (!endpoint.path.startsWith("/") || endpoint.path.includes("?")) {
    throw new Error(`Invalid API path for ${endpoint.id}: ${endpoint.path}.`);
  }
  if (!endpoint.sourceUrl.startsWith("https://developers.ploi.io/")) {
    throw new Error(`Invalid documentation URL for ${endpoint.id}.`);
  }
}
