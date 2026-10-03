import { readFile } from "node:fs/promises";
import { printValue } from "../cli/output.mjs";
import { redactSecrets } from "../cli/redact.mjs";
import { createPloiClient } from "./api-client.mjs";
import { ploiCatalog } from "./api-endpoints.mjs";
import { confirmMutation, withSpinner } from "../cli/ui.mjs";

export const PLOI_API_OPTIONS = [
  "server",
  "site",
  "path",
  "query",
  "data",
  "dataFile",
  "page",
  "perPage",
  "maxPages",
  "all",
  "yes",
  "dryRun",
];

export function isPloiApiCommand(command) {
  return command[0] === "ploi" && command[1] === "api";
}

export function validatePloiApiCommand(parsed) {
  const action = parsed.command[2];
  if (!action) {
    throw new Error(
      "Usage: gq ploi api <operation-id>, gq ploi api list, or gq ploi api describe <operation-id>.",
    );
  }
  if (action === "list") {
    if (parsed.command.length !== 3) {
      throw new Error("gq ploi api list does not accept positional arguments.");
    }
    rejectOptionsExcept(parsed, ["group", "search"]);
    return;
  }
  if (action === "describe") {
    if (parsed.command.length !== 4) {
      throw new Error("gq ploi api describe requires an operation ID.");
    }
    rejectOptionsExcept(parsed, []);
    return;
  }
  if (parsed.command.length !== 3) {
    throw new Error(`Unknown Ploi API command: ${parsed.command.join(" ")}.`);
  }
  rejectOptionsExcept(parsed, PLOI_API_OPTIONS);
}

export function runPloiApiCatalogCommand(parsed, io) {
  const action = parsed.command[2];
  if (action === "list") {
    const endpoints = ploiCatalog.list({
      group: parsed.group,
      search: parsed.search,
    });
    printValue(
      io,
      endpoints.map(({ id, method, path, summary }) => ({
        id,
        method,
        path,
        summary,
      })),
      parsed,
    );
    return true;
  }
  if (action === "describe") {
    const endpoint = ploiCatalog.get(parsed.command[3]);
    printValue(
      io,
      {
        ...endpoint,
        pathParameters: pathParameterNames(endpoint.path).join(", "),
        mutationRequiresConfirmation: endpoint.method !== "GET",
      },
      parsed,
    );
    return true;
  }
  return false;
}

export async function runPloiApiCommand({ context, parsed, fetch, io, interactive }) {
  const endpoint = ploiCatalog.get(parsed.command[2]);
  const pathParameters = parseNameValues(parsed.path, "--path");
  const query = parseNameValues(parsed.query, "--query", { repeated: true });
  applyContextPathDefaults(endpoint, pathParameters, parsed, context);
  if (parsed.page) query.page = positiveInteger(parsed.page, "--page");
  if (parsed.perPage) query.per_page = positiveInteger(parsed.perPage, "--per-page");

  const body = await readBody(parsed, context);
  const client = createPloiClient({
    token: context.env.PLOI_API_TOKEN,
    fetchImplementation: fetch,
  });
  const request = client.prepareEndpoint(endpoint, {
    pathParameters,
    query,
    body,
  });

  if (parsed.dryRun) {
    printValue(
      io,
      redactSecrets({
        operation: endpoint.id,
        method: request.method,
        url: request.url,
        body: request.body,
      }),
      { json: true },
    );
    return;
  }

  if (endpoint.method !== "GET" && !parsed.yes) {
    if (!interactive) {
      throw new Error(
        `${endpoint.id} changes remote state. Re-run with --yes or inspect it with --dry-run.`,
      );
    }
    const confirmed = await confirmMutation(
      redactSecrets({
        operation: endpoint.id,
        method: request.method,
        url: request.url,
      }),
    );
    if (!confirmed) return;
  }

  const result = await withSpinner(
    `Running ${endpoint.id}`,
    () =>
      client.executeEndpoint(endpoint, {
        pathParameters,
        query,
        body,
        paginate: parsed.all,
        maxPages: parsed.maxPages ? positiveInteger(parsed.maxPages, "--max-pages") : undefined,
      }),
    interactive,
  );
  printValue(io, redactSecrets(result), { json: true });
}

async function readBody(parsed, context) {
  if (parsed.data !== undefined && parsed.dataFile !== undefined) {
    throw new Error("Use either --data or --data-file, not both.");
  }
  if (parsed.data !== undefined) return parseJson(parsed.data, "--data");
  if (parsed.dataFile !== undefined) {
    const path = context.resolvePath(parsed.dataFile);
    return parseJson(await readFile(path, "utf8"), path);
  }
  return undefined;
}

function applyContextPathDefaults(endpoint, values, parsed, context) {
  const placeholders = new Set(pathParameterNames(endpoint.path));
  if (placeholders.has("server") && values.server === undefined) {
    values.server = parsed.server || context.env.PLOI_SERVER_ID || context.config.ploi?.serverId;
  }
  if (placeholders.has("site") && values.site === undefined) {
    values.site = parsed.site || context.env.PLOI_SITE_ID || context.config.ploi?.siteId;
  }
}

function pathParameterNames(path) {
  return [...new Set([...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]))];
}

function parseNameValues(entries, option, { repeated = false } = {}) {
  const result = {};
  for (const entry of entries || []) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new Error(`${option} must use name=value syntax.`);
    }
    const name = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (!repeated && Object.hasOwn(result, name)) {
      throw new Error(`${option} ${name} was provided more than once.`);
    }
    if (repeated && Object.hasOwn(result, name)) {
      result[name] = Array.isArray(result[name]) ? [...result[name], value] : [result[name], value];
    } else {
      result[name] = value;
    }
  }
  return result;
}

function parseJson(value, source) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${source} must contain valid JSON: ${error.message}`, {
      cause: error,
    });
  }
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

function rejectOptionsExcept(parsed, allowed) {
  const globals = new Set(["command", "help", "json", "project", "config"]);
  const accepted = new Set(allowed);
  for (const key of Object.keys(parsed)) {
    if (!globals.has(key) && !accepted.has(key)) {
      throw new Error(
        `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is not valid for ${parsed.command.join(" ")}.`,
      );
    }
  }
}
