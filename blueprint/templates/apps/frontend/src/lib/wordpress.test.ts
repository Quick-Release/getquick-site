import { afterEach, expect, test, vi } from "vite-plus/test";
import { getEntryByUri, getHomeContent, getSiteChrome } from "./wordpress";

test("home content comes from the page marked as the WordPress front page", async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as { query: string };
    expect(request.query).toContain('nodeByUri(uri: "/")');
    expect(request.query).toContain("isFrontPage");
    expect(request.query).toContain(
      "blocks(attributes: true, htmlContent: true, dynamicContent: true, postTemplate: false)",
    );
    expect(request.query).not.toContain("posts(first: 6)");

    return {
      ok: true,
      json: async () => ({
        data: {
          generalSettings: { title: "Acme", description: "Description" },
          nodeByUri: {
            __typename: "Page",
            isFrontPage: true,
            title: "Home",
            content: '<div class="wp-block-group"><h1>Welcome</h1></div>',
          },
          designTokens: {
            colors: [{ slug: "accent", color: "#e7472e" }],
            spacingSizes: [{ slug: "md", size: "2rem" }],
          },
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  expect(await getHomeContent()).toMatchObject({
    connected: true,
    settings: { title: "Acme", description: "Description" },
    page: {
      title: "Home",
      content: '<div class="wp-block-group"><h1>Welcome</h1></div>',
    },
    spacingSizes: [{ slug: "md", size: "2rem" }],
    colors: [{ slug: "accent", color: "#e7472e" }],
  });
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("renders a homepage Video Hero from its structured GraphQL attributes", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        generalSettings: { title: "Acme", description: "Description" },
        nodeByUri: {
          __typename: "Page",
          isFrontPage: true,
          title: "Home",
          content: "<section>Saved block HTML</section>",
          blocks: JSON.stringify([
            {
              name: "getquick-design/video-hero",
              attributes: {
                videoType: "youtube",
                videoId: 0,
                videoUrl: "https://youtu.be/abcdefghijk",
                posterId: 0,
                posterUrl: "",
              },
              htmlContent: '<section class="wp-block-getquick-design-video-hero"></section>',
              innerBlocks: [
                {
                  name: "core/heading",
                  attributes: { level: 1 },
                  htmlContent: "<h1>Welcome</h1>",
                  innerBlocks: [],
                },
              ],
            },
          ]),
        },
        designTokens: { colors: [], spacingSizes: [] },
      },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await getHomeContent();

  expect(result.page?.hasVideoHero).toBe(true);
  expect(result.page?.content).toContain("youtube-nocookie.com/embed/abcdefghijk");
  expect(result.page?.content).toContain("playlist=abcdefghijk");
  expect(result.page?.content).toContain("<h1>Welcome</h1>");
  expect(result.page?.content).not.toContain("Saved block HTML");
});

test("does not use a page unless WordPress marks it as the front page", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        generalSettings: null,
        nodeByUri: {
          __typename: "Page",
          isFrontPage: false,
          title: "Not the homepage",
          content: "<p>Other page</p>",
        },
        designTokens: { colors: [], spacingSizes: [] },
      },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  expect(await getHomeContent()).toMatchObject({ connected: true, page: null });
});

afterEach(() => vi.unstubAllGlobals());

test("page content includes the CMS spacing presets, including numeric and overridden slugs", async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as {
      query: string;
      variables: { uri: string };
    };
    expect(request.query).toContain("query EntryByUri($uri: String!, $withBlocks: Boolean = true)");
    expect(request.query).toContain("spacingSizes");
    expect(request.query).toContain("colors");
    expect(request.variables.uri).toBe("/sample-page/");

    return {
      ok: true,
      json: async () => ({
        data: {
          postBy: null,
          pageBy: {
            id: "1",
            title: "Sample Page",
            content: "<p>Content</p>",
            uri: "/sample-page/",
            featuredImage: null,
          },
          designTokens: {
            colors: [{ slug: "accent", color: "#2563eb" }],
            spacingSizes: [
              { slug: "20", size: "0.44rem" },
              { slug: "md", size: "2rem" },
            ],
          },
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  expect(await getEntryByUri("/sample-page/")).toMatchObject({
    title: "Sample Page",
    date: "",
    excerpt: "",
    spacingSizes: [
      { slug: "20", size: "0.44rem" },
      { slug: "md", size: "2rem" },
    ],
    colors: [{ slug: "accent", color: "#2563eb" }],
  });
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("an entry whose blocks WordPress fails to return still loads, without them", async () => {
  // The CMS can answer a 502 for one page's block attributes.
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as {
      variables: { withBlocks?: boolean };
    };
    if (request.variables.withBlocks !== false) return { ok: false, status: 502 };

    return {
      ok: true,
      json: async () => ({
        data: {
          postBy: null,
          pageBy: {
            id: "64",
            title: "About",
            content: "<p>Content</p>",
            uri: "/about/",
            featuredImage: null,
          },
          designTokens: { colors: [], spacingSizes: [] },
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  expect(await getEntryByUri("/about/")).toMatchObject({
    title: "About",
    content: "<p>Content</p>",
    hasVideoHero: false,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("an entry request that times out is not retried", async () => {
  const fetchMock = vi.fn(async () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  });
  vi.stubGlobal("fetch", fetchMock);

  expect(await getEntryByUri("/about/")).toBeNull();
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("site chrome includes the WordPress favicon, logo and primary menu", async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as {
      query: string;
      variables: Record<string, string>;
    };
    expect(request.query).toContain("siteIcon");
    expect(request.query).toContain("siteLogo");
    expect(request.query).toContain("menuItems(where: { location: $location }");
    expect(request.variables).toEqual({ location: "PRIMARY" });

    return {
      ok: true,
      json: async () => ({
        data: {
          generalSettings: {
            siteIcon: {
              node: { sourceUrl: "https://media.example/favicon.png", altText: "" },
            },
            siteLogo: {
              node: { sourceUrl: "https://media.example/logo.svg", altText: "Acme" },
            },
          },
          menuItems: {
            nodes: [
              {
                id: "a",
                parentId: null,
                label: "Projetos",
                url: "https://{{project}}-admin.ddev.site/work/",
                target: null,
              },
              {
                id: "b",
                parentId: "a",
                label: "Casa",
                url: "https://{{project}}.example/work/house/?x=1#top",
                target: "",
              },
              {
                id: "c",
                parentId: null,
                label: "Instagram",
                url: "https://instagram.com/{{project}}",
                target: "_blank",
              },
            ],
          },
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  expect(await getSiteChrome("https://{{project}}.example")).toEqual({
    siteIcon: { sourceUrl: "https://media.example/favicon.png", altText: "" },
    siteLogo: { sourceUrl: "https://media.example/logo.svg", altText: "Acme" },
    menuItems: [
      {
        id: "a",
        label: "Projetos",
        href: "/work/",
        target: null,
        children: [
          { id: "b", label: "Casa", href: "/work/house/?x=1#top", target: null, children: [] },
        ],
      },
      {
        id: "c",
        label: "Instagram",
        href: "https://instagram.com/{{project}}",
        target: "_blank",
        children: [],
      },
    ],
  });
});

test("site chrome falls back to the default favicon, no logo and an empty menu when WordPress is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 503 })),
  );
  expect(await getSiteChrome()).toEqual({ menuItems: [], siteIcon: null, siteLogo: null });
});
