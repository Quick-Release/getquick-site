// The trusted refresh: POST with `Authorization: Bearer <FRONTEND_REFRESH_TOKEN>`
// reads the front page and the site chrome from the CMS and promotes what it
// read completely into the publication store (src/lib/delivery.ts). `gq
// frontend refresh` calls it. The answer is a report for the operator: 200
// when everything was refreshed, 503 when something kept its stored version.
import type { APIRoute } from "astro";
import { isAuthorized, refreshAuthority, refreshHomepage } from "../../lib/delivery";

export const prerender = false;

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export const POST: APIRoute = async ({ request, site }) => {
  const authority = await refreshAuthority();
  if ("refused" in authority) {
    return answer(403, { error: `Refresh is disabled: ${authority.refused}.` });
  }
  if (!(await isAuthorized(request, authority.token))) {
    return answer(
      401,
      { error: "A refresh needs this Frontend's refresh token as a bearer token." },
      { "WWW-Authenticate": 'Bearer realm="gq-refresh"' },
    );
  }

  const report = await refreshHomepage(authority.store, site?.origin);
  return answer(report.refreshed ? 200 : 503, report);
};

export const ALL: APIRoute = () => answer(405, { error: "Refresh with POST." }, { Allow: "POST" });
