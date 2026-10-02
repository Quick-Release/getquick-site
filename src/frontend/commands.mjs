// `gq frontend refresh`: the trusted refresh of a content site's durable
// homepage. It asks the deployed Frontend (POST /gq/refresh, the Frontend's
// src/pages/gq/refresh.ts) to read the front page and the site chrome from the
// CMS and promote what it read completely into its publication store. The
// bearer token is FRONTEND_REFRESH_TOKEN, injected by gq sigillo run staging;
// it is sent only to the Frontend and never printed. Exits 1 until the
// Frontend is ready and everything was refreshed, so it can gate a script.
//
//   gq frontend refresh [--url <frontend origin>] [--json]

export const FRONTEND_USAGE = ["gq frontend refresh [--url <frontend origin>] [--json]"];

const MARKS = { promoted: "✓", superseded: "✓", kept: "✗" };

export function isFrontendCommand(command) {
  return command.join(" ") === "frontend refresh";
}

export function frontendCommandOptions(command) {
  return isFrontendCommand(command) ? ["url"] : undefined;
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

// Resolves to the exit code: 0 when the Frontend is ready and refreshed, 1 when not.
export async function runFrontendCommand({ context, parsed, fetch, io }) {
  const url = frontendOrigin(parsed, context.config);
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
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`The Frontend at ${url.origin} couldn't be reached: ${error.message}`, {
      cause: error,
    });
  }

  const body = await response.json().catch(() => null);
  const isReport = body && typeof body === "object" && "home" in body && "chrome" in body;
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
    for (const [label, outcome] of [
      ["front page", body.home],
      ["site chrome", body.chrome],
    ]) {
      const detail =
        outcome.outcome === "kept"
          ? `kept the stored version (${outcome.failure.reason}): ${outcome.failure.message}`
          : `${outcome.outcome} (${outcome.state})`;
      io.out(`  ${MARKS[outcome.outcome] ?? "?"} ${label}: ${detail}`);
    }
    io.out(
      body.ready
        ? body.refreshed
          ? "Ready: the homepage is served from the publication store."
          : "Ready, but not refreshed: visitors get the last stored version until a refresh succeeds."
        : "Not ready: the homepage is a 503 until a refresh stores the front page and the site chrome.",
    );
  }
  return body.ready && body.refreshed ? 0 : 1;
}
