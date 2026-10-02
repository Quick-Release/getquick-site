// `gq frontend refresh`: the trusted refresh of a content site's published
// content. It asks the deployed Frontend (POST /gq/refresh, the Frontend's
// src/pages/gq/refresh.ts) to read published content from the CMS and promote
// what it read completely into its publication store: the whole Site (front
// page, site chrome and every published page and post), or with --uri only the
// entries at those paths (a new publication, or a changed URI). The bearer
// token is FRONTEND_REFRESH_TOKEN, injected by gq sigillo run staging; it is
// sent only to the Frontend and never printed. Exits 1 until everything asked
// for was refreshed (and, for the whole Site, the homepage is ready), so it
// can gate a script.
//
//   gq frontend refresh [--uri <path>]... [--url <frontend origin>] [--json]

export const FRONTEND_USAGE = [
  "gq frontend refresh [--uri <path>]... [--url <frontend origin>] [--json]",
];

const MARKS = { promoted: "✓", superseded: "✓", kept: "✗" };

export function isFrontendCommand(command) {
  return command.join(" ") === "frontend refresh";
}

export function frontendCommandOptions(command) {
  return isFrontendCommand(command) ? ["url", "uri"] : undefined;
}

function frontendOrigin(parsed, ops) {
  const origin = parsed.url ?? (ops.domains?.frontend ? `https://${ops.domains.frontend}` : null);
  if (!origin) {
    throw new Error("gq.ops.json domains.frontend is required, or pass --url <frontend origin>.");
  }
  let url;
  try {
    url = new URL("/gq/refresh", origin);
  } catch {
    throw new Error(`--url must be an origin such as https://www.example.com, not ${origin}.`);
  }
  // The token travels in the request: only to a Frontend over HTTPS, or to
  // this machine (a local runtime proof).
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`The refresh token is only sent over HTTPS (or to localhost), not ${origin}.`);
  }
  return url;
}

function requestedUris(parsed) {
  const uris = parsed.uri ?? [];
  for (const uri of uris) {
    if (!uri.startsWith("/") || uri.startsWith("//") || /[?#\s]/u.test(uri)) {
      throw new Error(`--uri must be a path such as /about/, not ${uri}.`);
    }
  }
  return uris;
}

function describe(outcome) {
  if (outcome.outcome === "kept") {
    return `kept the stored version (${outcome.failure.reason}): ${outcome.failure.message}`;
  }
  return `${outcome.outcome} (${outcome.state}${outcome.uri ? ` to ${outcome.uri}` : ""})`;
}

function printReport(body, io) {
  const lines = [];
  if (body.home) lines.push(["front page", body.home]);
  if (body.chrome) lines.push(["site chrome", body.chrome]);
  for (const [label, outcome] of lines) {
    io.out(`  ${MARKS[outcome.outcome] ?? "?"} ${label}: ${describe(outcome)}`);
  }
  if (body.routes) {
    io.out(
      body.routes.outcome === "listed"
        ? `  ✓ published routes: ${body.routes.count} listed`
        : `  ✗ published routes: not listed (${body.routes.failure.reason}): ${body.routes.failure.message}`,
    );
  }
  for (const [route, outcome] of Object.entries(body.entries ?? {})) {
    io.out(`  ${MARKS[outcome.outcome] ?? "?"} ${route}: ${describe(outcome)}`);
  }
  for (const [from, to] of Object.entries(body.moved ?? {})) {
    io.out(`  ✓ ${from}: moved to ${to}, and redirects there`);
  }
}

// Resolves to the exit code: 0 when everything asked for was refreshed, 1 when not.
export async function runFrontendCommand({ context, parsed, fetch, io }) {
  const url = frontendOrigin(parsed, context.config);
  const uris = requestedUris(parsed);
  const token = context.env.FRONTEND_REFRESH_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "FRONTEND_REFRESH_TOKEN is missing; add it to Sigillo staging, deploy the Frontend with it and run this through gq sigillo run staging.",
    );
  }

  let response;
  try {
    response = await fetch(url.href, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(uris.length > 0 ? { uris } : {}),
      signal: AbortSignal.timeout(uris.length > 0 ? 30_000 : 300_000),
    });
  } catch (error) {
    throw new Error(`The Frontend at ${url.origin} couldn't be reached: ${error.message}`, {
      cause: error,
    });
  }

  const body = await response.json().catch(() => null);
  const site = uris.length === 0;
  // A Frontend from before entries were stored reports only the homepage.
  const isReport =
    body &&
    typeof body === "object" &&
    (site ? "home" in body && "chrome" in body : typeof body.entries === "object");
  if (!isReport) {
    const reason = body?.error ?? `HTTP ${response.status}`;
    if (parsed.json) io.out(JSON.stringify({ status: response.status, error: reason }, null, 2));
    else io.out(`The Frontend at ${url.origin} refused the refresh: ${reason}`);
    return 1;
  }

  if (parsed.json) {
    io.out(JSON.stringify(body, null, 2));
  } else {
    io.out(`Frontend refresh (${url.origin})`);
    printReport(body, io);
    if (!site) {
      io.out(
        body.refreshed
          ? "Refreshed: these entries are served from the publication store."
          : "Not refreshed: entries that kept their stored version are served as before until a refresh succeeds.",
      );
    } else {
      io.out(
        body.ready
          ? body.refreshed
            ? "Ready: published content is served from the publication store."
            : "Ready, but not refreshed: visitors get the last stored versions until a refresh succeeds."
          : "Not ready: pages are a 503 until a refresh stores the front page and the site chrome.",
      );
    }
  }
  return body.refreshed && (!site || body.ready) ? 0 : 1;
}
