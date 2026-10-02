// A stubbed WordPress for the rendered-route tests, answering each GraphQL
// query by name.
import { vi } from "vite-plus/test";

export type Answer = { ok: false; status: number } | { ok: true; json: () => Promise<unknown> };
export type Handler = (variables: Record<string, unknown>) => Answer | Promise<Answer>;

export const tokens = { colors: [], spacingSizes: [] };

export const chrome = {
  generalSettings: {
    siteIcon: null,
    siteLogo: { node: { sourceUrl: "https://media.example/logo.svg", altText: "Acme" } },
  },
  menuItems: {
    nodes: [{ id: "a", parentId: null, label: "About us", url: "/about/", target: null }],
  },
};

/** WordPress's list of published routes, on one page. */
export function routes(...uris: string[]): Answer {
  return data({
    contentNodes: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: uris.map((uri) => ({ uri })),
    },
  });
}

export function data(value: unknown): Answer {
  return { ok: true, json: async () => ({ data: value }) };
}

export function httpError(status: number): Answer {
  return { ok: false, status };
}

export function timeout(): never {
  throw new DOMException("The operation timed out.", "TimeoutError");
}

// The site chrome and the design presets are fine, and nothing but the front
// page is published, unless a test says otherwise; any other query fails the
// test.
export function stubWordPress(handlers: {
  home?: Handler;
  entry?: Handler;
  chrome?: Handler;
  design?: Handler;
  routes?: Handler;
}) {
  const answer = {
    chrome: () => data(chrome),
    design: () => data({ designTokens: tokens }),
    routes: () => routes("/"),
    ...handlers,
  };
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const name = /query (\w+)/.exec(request.query)?.[1];
    const handler = {
      HomePage: answer.home,
      EntryByUri: answer.entry,
      SiteChrome: answer.chrome,
      DesignPresets: answer.design,
      PublishedRoutes: answer.routes,
    }[name ?? ""];
    if (!handler) throw new Error(`Unexpected query ${name}`);
    return handler(request.variables ?? {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function queries(fetchMock: ReturnType<typeof stubWordPress>, name: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init.body as string).includes(`query ${name}`));
}
