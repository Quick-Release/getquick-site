// The CMS's publication events: WordPress posts here, signed with the Site's
// PUBLICATION_EVENT_SECRET, when a page or post is published or updated, or a
// shared setting changes, and the Frontend refreshes it from WordPress
// (src/lib/events.ts). 200 when the
// event was refreshed, superseded by a newer one or already processed; 503
// when its refresh kept the stored versions (it is recorded as failed, for a
// retry); 4xx, changing nothing, when it is refused.
import type { APIRoute } from "astro";
import { receiveEvent } from "../../lib/events";

export const prerender = false;

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export const POST: APIRoute = async ({ request, site }) => {
  const { status, body } = await receiveEvent(request, { siteOrigin: site?.origin });
  return answer(status, body);
};

export const ALL: APIRoute = () =>
  answer(405, { error: "Deliver events with POST." }, { Allow: "POST" });
