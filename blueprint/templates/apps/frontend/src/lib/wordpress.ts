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

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface RawWordPressPost extends Omit<
  WordPressPost,
  "featuredImage" | "excerpt" | "date" | "hasVideoHero"
> {
  excerpt?: string;
  date?: string | null;
  featuredImage: { node: WordPressImage | null } | null;
  blocks?: unknown;
}

interface DesignTokens {
  spacingSizes: Array<{ slug: string; size: string }>;
  colors: Array<{ slug: string; color: string }>;
}

interface HomeNode {
  __typename: string;
  isFrontPage?: boolean;
  title?: string;
  content?: string | null;
  blocks?: unknown;
}

interface HomeQuery {
  generalSettings: WordPressSettings | null;
  nodeByUri: HomeNode | null;
  designTokens: DesignTokens;
}

interface RawMenuItem {
  id: string;
  parentId: string | null;
  label: string | null;
  url: string | null;
  target: string | null;
}

interface SiteChromeQuery {
  generalSettings: {
    siteIcon: { node: WordPressImage | null } | null;
    siteLogo: { node: WordPressImage | null } | null;
  } | null;
  menuItems: { nodes: RawMenuItem[] } | null;
}

interface EntryQuery {
  postBy: RawWordPressPost | null;
  pageBy: RawWordPressPost | null;
  designTokens: DesignTokens;
}

const homeQuery = /* GraphQL */ `
  query HomePage {
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

// Blocks can be left out (withBlocks: false) when WordPress fails to return them.
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
      featuredImage {
        node {
          sourceUrl
          altText
        }
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

function normalizePost(post: RawWordPressPost): WordPressPost {
  return {
    ...post,
    excerpt: post.excerpt ?? "",
    date: post.date ?? "",
    featuredImage: post.featuredImage?.node ?? null,
    hasVideoHero: hasVideoHero(parseWordPressBlocks(post.blocks)),
  };
}

/** WordPress answered, with an HTTP error status. */
class WordPressHttpError extends Error {
  constructor(readonly status: number) {
    super(`WordPress responded with HTTP ${status}`);
  }
}

async function query<T>(queryText: string, variables?: Record<string, string | boolean>) {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: queryText, variables }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new WordPressHttpError(response.status);
  }

  const result = (await response.json()) as GraphQLResponse<T>;
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join(", "));
  }

  if (!result.data) {
    throw new Error("WordPress returned no data");
  }

  return result.data;
}

export async function getHomeContent() {
  try {
    const data = await query<HomeQuery>(homeQuery);
    const node = data.nodeByUri;
    const blocks = parseWordPressBlocks(node?.blocks);
    const containsVideoHero = hasVideoHero(blocks);
    const page =
      node?.__typename === "Page" && node.isFrontPage
        ? {
            title: node.title ?? "",
            content: containsVideoHero ? renderWordPressBlocks(blocks) : (node.content ?? ""),
            hasVideoHero: containsVideoHero,
          }
        : null;

    return {
      connected: true,
      settings: data.generalSettings,
      page,
      spacingSizes: data.designTokens.spacingSizes,
      colors: data.designTokens.colors,
    };
  } catch {
    return {
      connected: false,
      settings: null,
      page: null,
      spacingSizes: [],
      colors: [],
    };
  }
}

export async function getEntryByUri(uri: string) {
  try {
    const variables = { uri };
    // The CMS can fail on one page's blocks (a 502 for a block's attributes)
    // while the rest of the entry is fine: retry without them rather than
    // show a 404. Only video-hero pages need blocks.
    const data = await query<EntryQuery>(entryQuery, variables).catch((error: unknown) => {
      if (error instanceof WordPressHttpError && error.status >= 500) {
        return query<EntryQuery>(entryQuery, { ...variables, withBlocks: false });
      }
      throw error;
    });
    const post = data.postBy ?? data.pageBy;
    if (!post) return null;

    const normalized = normalizePost(post);
    const blocks = parseWordPressBlocks(post.blocks);
    const containsVideoHero = hasVideoHero(blocks);

    return {
      ...normalized,
      content: containsVideoHero ? renderWordPressBlocks(blocks) : normalized.content,
      hasVideoHero: containsVideoHero,
      spacingSizes: data.designTokens.spacingSizes,
      colors: data.designTokens.colors,
    };
  } catch {
    return null;
  }
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

export async function getSiteChrome(siteOrigin?: string, location = "PRIMARY") {
  try {
    const data = await query<SiteChromeQuery>(siteChromeQuery, { location });
    const origins = [new URL(endpoint()).origin, ...(siteOrigin ? [siteOrigin] : [])];

    return {
      menuItems: buildMenuTree(data.menuItems?.nodes ?? [], origins),
      siteIcon: data.generalSettings?.siteIcon?.node ?? null,
      siteLogo: data.generalSettings?.siteLogo?.node ?? null,
    };
  } catch {
    return { menuItems: [], siteIcon: null, siteLogo: null };
  }
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
