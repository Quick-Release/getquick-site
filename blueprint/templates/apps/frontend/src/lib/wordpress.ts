import { z } from "astro/zod";
import { hasVideoHero, parseWordPressBlocks, renderWordPressBlocks } from "./wp-block-renderer";

export interface WordPressImage {
  sourceUrl: string;
  altText: string;
}

export interface WordPressPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  uri: string;
  date: string;
  featuredImage: WordPressImage | null;
  hasVideoHero: boolean;
}

export interface WordPressMenuItem {
  id: string;
  label: string;
  href: string;
  target: string | null;
  children: WordPressMenuItem[];
}

export interface WordPressSettings {
  title: string;
  description: string;
}

export interface DesignPresets {
  spacingSizes: Array<{ slug: string; size: string }>;
  colors: Array<{ slug: string; color: string }>;
}

export interface HomeContent extends DesignPresets {
  settings: WordPressSettings;
  page: { title: string; content: string; hasVideoHero: boolean };
  /** WordPress failed on the blocks, so this is the page without them. */
  blocksOmitted: boolean;
}

export interface EntryContent extends WordPressPost, DesignPresets {
  /** WordPress failed on the blocks, so this is the entry without them. */
  blocksOmitted: boolean;
}

export interface SiteChrome {
  menuItems: WordPressMenuItem[];
  siteIcon: WordPressImage | null;
  siteLogo: WordPressImage | null;
}

/**
 * Why WordPress couldn't deliver: it didn't answer in time (`timeout`), couldn't
 * be reached (`network`), answered with an HTTP error (`http`) or GraphQL errors
 * (`graphql`), or answered with data missing the fields the Frontend requires
 * (`schema`).
 */
export type CmsFailureReason = "timeout" | "network" | "http" | "graphql" | "schema";

export interface CmsFailure {
  reason: CmsFailureReason;
  message: string;
  httpStatus?: number;
}

export interface Found<T> {
  kind: "found";
  content: T;
}

/** WordPress answered with valid data, and has nothing published there. */
export interface Missing {
  kind: "missing";
}

/** The content couldn't be read. This says nothing about whether it exists. */
export interface Unavailable {
  kind: "unavailable";
  failure: CmsFailure;
}

export type Delivery<T> = Found<T> | Missing | Unavailable;

/** Found is 200, confirmed missing is 404, and a CMS failure is 503, never 404. */
export function responseStatus(delivery: { kind: Delivery<unknown>["kind"] }) {
  if (delivery.kind === "found") return 200;
  return delivery.kind === "missing" ? 404 : 503;
}

// The GETQUICK schema the Frontend requires. A field WordPress leaves out, or
// returns with another type, fails the read: only the fields declared nullable
// here may be null, and only those fall back to a default.
const image = z.object({ sourceUrl: z.string(), altText: z.string().nullable() });
const imageEdge = z.object({ node: image.nullable() }).nullable();

const designTokens = z.object({
  spacingSizes: z.array(z.object({ slug: z.string(), size: z.string() })),
  colors: z.array(z.object({ slug: z.string(), color: z.string() })),
});

const homeData = z.object({
  generalSettings: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
  nodeByUri: z
    .union([
      z.object({
        __typename: z.literal("Page"),
        isFrontPage: z.boolean(),
        title: z.string().nullable(),
        content: z.string().nullable(),
        // Left out when read without blocks.
        blocks: z.unknown().optional(),
      }),
      z.object({ __typename: z.string().refine((typename) => typename !== "Page") }),
    ])
    .nullable(),
  designTokens,
});

const pageEntry = z.object({
  id: z.string(),
  title: z.string().nullable(),
  content: z.string().nullable(),
  uri: z.string(),
  // Only `publish` and unrestricted is public. A password-protected entry is
  // restricted: WordPress lists it to anonymous readers, without its content.
  status: z.string().nullable(),
  isRestricted: z.boolean().nullable(),
  featuredImage: imageEdge,
  // Left out when read without blocks.
  blocks: z.unknown().optional(),
});
const postEntry = pageEntry.extend({ excerpt: z.string().nullable(), date: z.string().nullable() });

const entryData = z.object({
  postBy: postEntry.nullable(),
  pageBy: pageEntry.nullable(),
  designTokens,
});

const designData = z.object({ designTokens });

const menuItem = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  label: z.string().nullable(),
  url: z.string().nullable(),
  target: z.string().nullable(),
});

const publishedRoutesData = z.object({
  contentNodes: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    nodes: z.array(z.object({ uri: z.string().nullable() })),
  }),
});

const siteChromeData = z.object({
  generalSettings: z.object({ siteIcon: imageEdge, siteLogo: imageEdge }),
  menuItems: z.object({ nodes: z.array(menuItem) }),
});

type RawEntry = z.infer<typeof pageEntry> & Partial<z.infer<typeof postEntry>>;
type RawMenuItem = z.infer<typeof menuItem>;

// Blocks are left out (withBlocks: false) when WordPress fails to return them.
const homeQuery = /* GraphQL */ `
  query HomePage($withBlocks: Boolean = true) {
    generalSettings {
      title
      description
    }
    nodeByUri(uri: "/") {
      __typename
      ... on Page {
        title
        content
        blocks(attributes: true, htmlContent: true, dynamicContent: true, postTemplate: false)
          @include(if: $withBlocks)
        isFrontPage
      }
    }
    designTokens {
      spacingSizes {
        slug
        size
      }
      colors {
        slug
        color
      }
    }
  }
`;

// WPGraphQL only exposes menus assigned to a theme location to anonymous callers.
const siteChromeQuery = /* GraphQL */ `
  query SiteChrome($location: MenuLocationEnum!) {
    generalSettings {
      siteIcon {
        node {
          sourceUrl
          altText
        }
      }
      siteLogo {
        node {
          sourceUrl
          altText
        }
      }
    }
    menuItems(where: { location: $location }, first: 100) {
      nodes {
        id
        parentId
        label
        url
        target
      }
    }
  }
`;

// Blocks are left out (withBlocks: false) when WordPress fails to return them.
const entryQuery = /* GraphQL */ `
  query EntryByUri($uri: String!, $withBlocks: Boolean = true) {
    designTokens {
      colors {
        slug
        color
      }
      spacingSizes {
        slug
        size
      }
    }
    postBy(uri: $uri) {
      id
      title
      excerpt
      content
      blocks(attributes: true, htmlContent: true, dynamicContent: true, postTemplate: false)
        @include(if: $withBlocks)
      uri
      date
      status
      isRestricted
      featuredImage {
        node {
          sourceUrl
          altText
        }
      }
    }
    pageBy(uri: $uri) {
      id
      title
      content
      blocks(attributes: true, htmlContent: true, dynamicContent: true, postTemplate: false)
        @include(if: $withBlocks)
      uri
      status
      isRestricted
      featuredImage {
        node {
          sourceUrl
          altText
        }
      }
    }
  }
`;

// The design presets alone, for a change to them that reaches every page.
const designQuery = /* GraphQL */ `
  query DesignPresets {
    designTokens {
      spacingSizes {
        slug
        size
      }
      colors {
        slug
        color
      }
    }
  }
`;

// Anonymous readers only get what is published: no drafts, private entries or
// revisions.
const publishedRoutesQuery = /* GraphQL */ `
  query PublishedRoutes($after: String) {
    contentNodes(first: 100, after: $after, where: { contentTypes: [PAGE, POST] }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        uri
      }
    }
  }
`;

function endpoint() {
  return (
    import.meta.env.PUBLIC_WORDPRESS_GRAPHQL_URL?.trim() ||
    "https://{{project}}-admin.ddev.site/wp/graphql"
  );
}

function normalizeImage(edge: z.infer<typeof imageEdge>): WordPressImage | null {
  const node = edge?.node;
  return node ? { sourceUrl: node.sourceUrl, altText: node.altText ?? "" } : null;
}

function normalizePost(post: RawEntry): WordPressPost {
  return {
    id: post.id,
    title: post.title ?? "",
    excerpt: post.excerpt ?? "",
    content: post.content ?? "",
    uri: post.uri,
    date: post.date ?? "",
    featuredImage: normalizeImage(post.featuredImage),
    hasVideoHero: hasVideoHero(parseWordPressBlocks(post.blocks)),
  };
}

/** A read WordPress didn't complete; becomes an Unavailable delivery. */
class CmsFailureError extends Error {
  constructor(
    readonly failure: CmsFailure,
    options?: { cause?: unknown },
  ) {
    super(failure.message, options);
  }
}

function describeIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "data"}: ${issue.message}`)
    .join("; ");
}

async function query<S extends z.ZodType>(
  schema: S,
  queryText: string,
  variables?: Record<string, string | boolean | null>,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: queryText, variables }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new CmsFailureError(
      timedOut
        ? { reason: "timeout", message: "WordPress didn't answer within 8 seconds" }
        : { reason: "network", message: `WordPress couldn't be reached: ${String(error)}` },
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new CmsFailureError({
      reason: "http",
      httpStatus: response.status,
      message: `WordPress responded with HTTP ${response.status}`,
    });
  }

  let result: { data?: unknown; errors?: Array<{ message: string }> } | null;
  try {
    result = await response.json();
  } catch (error) {
    throw new CmsFailureError(
      { reason: "schema", message: "WordPress answered with something other than JSON" },
      { cause: error },
    );
  }

  // Any GraphQL error fails the read, even next to partial data: a field it
  // nulled out isn't evidence that the content is gone.
  if (result?.errors?.length) {
    throw new CmsFailureError({
      reason: "graphql",
      message: result.errors.map((error) => error.message).join(", "),
    });
  }

  const parsed = schema.safeParse(result?.data);
  if (!parsed.success) {
    throw new CmsFailureError({
      reason: "schema",
      message: `WordPress's answer doesn't match the required schema: ${describeIssues(parsed.error)}`,
    });
  }
  return parsed.data;
}

function isServerError(error: unknown) {
  return (
    error instanceof CmsFailureError &&
    error.failure.reason === "http" &&
    (error.failure.httpStatus ?? 0) >= 500
  );
}

/**
 * The CMS can fail on one page's blocks (a 502 for a block's attributes) while
 * the rest of it is fine: read it again without them rather than fail it. Only
 * Video Hero pages need blocks. A timeout isn't retried, and a retry that fails
 * too is a failure, never absence.
 */
async function queryWithBlockRecovery<S extends z.ZodType>(
  schema: S,
  queryText: string,
  variables: Record<string, string | boolean> = {},
): Promise<{ data: z.infer<S>; blocksOmitted: boolean }> {
  try {
    return { data: await query(schema, queryText, variables), blocksOmitted: false };
  } catch (error) {
    if (!isServerError(error)) throw error;
    try {
      const data = await query(schema, queryText, { ...variables, withBlocks: false });
      return { data, blocksOmitted: true };
    } catch (retryError) {
      if (!(retryError instanceof CmsFailureError)) throw retryError;
      const first = (error as CmsFailureError).failure;
      throw new CmsFailureError(
        {
          ...retryError.failure,
          message: `${first.message}; without blocks: ${retryError.failure.message}`,
        },
        { cause: retryError },
      );
    }
  }
}

/** Turns a CMS failure into an Unavailable delivery, and logs why. Other errors are bugs. */
async function deliver<R>(subject: string, read: () => Promise<R>): Promise<R | Unavailable> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof CmsFailureError)) throw error;
    console.error(
      `WordPress: ${subject} is unavailable (${error.failure.reason}): ${error.message}`,
    );
    return { kind: "unavailable", failure: error.failure };
  }
}

/** The page WordPress marks as the front page. Missing when no page is. */
export async function getHomeContent(): Promise<Delivery<HomeContent>> {
  return deliver("the front page", async (): Promise<Found<HomeContent> | Missing> => {
    const { data, blocksOmitted } = await queryWithBlockRecovery(homeData, homeQuery);
    const node = data.nodeByUri;
    if (!node || !("isFrontPage" in node) || !node.isFrontPage) return { kind: "missing" };

    const blocks = parseWordPressBlocks(node.blocks);
    const containsVideoHero = hasVideoHero(blocks);
    return {
      kind: "found",
      content: {
        settings: {
          title: data.generalSettings.title ?? "",
          description: data.generalSettings.description ?? "",
        },
        page: {
          title: node.title ?? "",
          content: containsVideoHero ? renderWordPressBlocks(blocks) : (node.content ?? ""),
          hasVideoHero: containsVideoHero,
        },
        blocksOmitted,
        spacingSizes: data.designTokens.spacingSizes,
        colors: data.designTokens.colors,
      },
    };
  });
}

/**
 * The published post or page at a URI. Missing when WordPress has neither, or
 * only one that isn't public (password-protected): the Frontend serves only
 * what any visitor may read.
 */
export async function getEntryByUri(uri: string): Promise<Delivery<EntryContent>> {
  return deliver(`the entry ${uri}`, async (): Promise<Found<EntryContent> | Missing> => {
    const { data, blocksOmitted } = await queryWithBlockRecovery(entryData, entryQuery, { uri });
    const post = data.postBy ?? data.pageBy;
    if (!post || post.isRestricted || post.status !== "publish") return { kind: "missing" };

    const normalized = normalizePost(post);
    const blocks = parseWordPressBlocks(post.blocks);
    const containsVideoHero = hasVideoHero(blocks);
    return {
      kind: "found",
      content: {
        ...normalized,
        content: containsVideoHero ? renderWordPressBlocks(blocks) : normalized.content,
        hasVideoHero: containsVideoHero,
        blocksOmitted,
        spacingSizes: data.designTokens.spacingSizes,
        colors: data.designTokens.colors,
      },
    };
  });
}

/** The design presets every page shares (GQ Design's spacing sizes and colors). */
export async function getDesignPresets(): Promise<Found<DesignPresets> | Unavailable> {
  return deliver("the design presets", async (): Promise<Found<DesignPresets>> => {
    const { designTokens } = await query(designData, designQuery);
    return {
      kind: "found",
      content: { spacingSizes: designTokens.spacingSizes, colors: designTokens.colors },
    };
  });
}

/**
 * The URI of every published page and post, read page by page. Any failed
 * page fails the list: an incomplete list says nothing about what isn't in it.
 */
export async function getPublishedRoutes(): Promise<Found<string[]> | Unavailable> {
  return deliver("the published routes", async (): Promise<Found<string[]>> => {
    const uris: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 1000; page += 1) {
      const { contentNodes }: z.infer<typeof publishedRoutesData> = await query(
        publishedRoutesData,
        publishedRoutesQuery,
        { after },
      );
      for (const node of contentNodes.nodes) if (node.uri) uris.push(node.uri);
      if (!contentNodes.pageInfo.hasNextPage) return { kind: "found", content: uris };
      if (!contentNodes.pageInfo.endCursor) {
        throw new CmsFailureError({
          reason: "schema",
          message: "WordPress said there are more published routes without a cursor to them",
        });
      }
      after = contentNodes.pageInfo.endCursor;
    }
    throw new CmsFailureError({
      reason: "schema",
      message: "WordPress listed more than 100,000 published routes",
    });
  });
}

/**
 * Links into this site (the WordPress origin, or the frontend origin WordPress
 * uses as its home URL) become frontend paths; other origins stay absolute.
 */
export function menuItemHref(url: string, internalOrigins: string[]) {
  try {
    const parsed = new URL(url, internalOrigins[0]);
    if (!internalOrigins.includes(parsed.origin)) return url;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

export function buildMenuTree(items: RawMenuItem[], internalOrigins: string[]) {
  const byId = new Map<string, WordPressMenuItem>();
  for (const item of items) {
    byId.set(item.id, {
      id: item.id,
      label: item.label ?? "",
      href: item.url ? menuItemHref(item.url, internalOrigins) : "#",
      target: item.target || null,
      children: [],
    });
  }

  const roots: WordPressMenuItem[] = [];
  for (const item of items) {
    const node = byId.get(item.id)!;
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/**
 * The menu, logo and icon every page shares. A site without them is found with
 * an empty menu and no images; a failed read is Unavailable, not that.
 */
export async function getSiteChrome(
  siteOrigin?: string,
  location = "PRIMARY",
): Promise<Found<SiteChrome> | Unavailable> {
  return deliver("the site chrome", async (): Promise<Found<SiteChrome>> => {
    const data = await query(siteChromeData, siteChromeQuery, { location });
    const origins = [new URL(endpoint()).origin, ...(siteOrigin ? [siteOrigin] : [])];

    return {
      kind: "found",
      content: {
        menuItems: buildMenuTree(data.menuItems.nodes, origins),
        siteIcon: normalizeImage(data.generalSettings.siteIcon),
        siteLogo: normalizeImage(data.generalSettings.siteLogo),
      },
    };
  });
}

export function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}
