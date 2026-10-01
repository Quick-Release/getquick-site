import { containerChildLayoutHtml, containerLayoutHtml } from "./wp-container-layout";

export interface WordPressBlock {
  name: string;
  attributes?: Record<string, unknown>;
  htmlContent?: string;
  /** Complete server-rendered HTML; htmlContent may be only a container shell. */
  dynamicContent?: string;
  innerBlocks?: WordPressBlock[];
}

export const VIDEO_HERO_BLOCK = "getquick-design/video-hero";

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const BLOCKS_WITH_RENDERED_CHILDREN = new Set([
  "core/cover",
  "core/media-text",
  "core/navigation",
  "core/navigation-submenu",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBlock(value: unknown): WordPressBlock | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;

  const attributes = isRecord(value.attributes) ? value.attributes : undefined;
  const innerBlocks = Array.isArray(value.innerBlocks)
    ? value.innerBlocks
        .map(normalizeBlock)
        .filter((block): block is WordPressBlock => block !== null)
    : [];

  return {
    name: value.name,
    attributes,
    htmlContent: typeof value.htmlContent === "string" ? value.htmlContent : "",
    dynamicContent: typeof value.dynamicContent === "string" ? value.dynamicContent : undefined,
    innerBlocks,
  };
}

export function parseWordPressBlocks(value: unknown): WordPressBlock[] {
  let parsed = value;

  // WPGraphQL's JSON scalar may arrive either as JSON data or JSON-encoded text.
  for (let attempt = 0; attempt < 2 && typeof parsed === "string"; attempt += 1) {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeBlock).filter((block): block is WordPressBlock => block !== null);
}

export function hasVideoHero(blocks: WordPressBlock[]): boolean {
  return blocks.some(
    (block) => block.name === VIDEO_HERO_BLOCK || hasVideoHero(block.innerBlocks ?? []),
  );
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeMediaUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!url || url.startsWith("//")) return "";
  if (url.startsWith("/")) return url;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : "";
  } catch {
    return "";
  }
}

export function youtubeVideoId(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";

    if (host === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      id = url.searchParams.get("v") ?? "";
      if (!id) {
        id = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? "";
      }
    }

    return YOUTUBE_ID_PATTERN.test(id) ? id : "";
  } catch {
    return "";
  }
}

function videoMarkup(attributes: Record<string, unknown>): string {
  const posterUrl = safeMediaUrl(attributes.posterUrl);
  const poster = posterUrl
    ? `<img class="wp-block-getquick-design-video-hero__poster" src="${escapeAttribute(posterUrl)}" alt="" decoding="async" />`
    : "";

  if (attributes.videoType === "youtube") {
    const videoId =
      typeof attributes.videoUrl === "string" ? youtubeVideoId(attributes.videoUrl) : "";
    if (!videoId) return poster;

    const query = new URLSearchParams({
      autoplay: "1",
      mute: "1",
      controls: "0",
      loop: "1",
      playlist: videoId,
      playsinline: "1",
      rel: "0",
    });
    return `${poster}<iframe class="wp-block-getquick-design-video-hero__video wp-block-getquick-design-video-hero__video--youtube" src="https://www.youtube-nocookie.com/embed/${videoId}?${query.toString()}" title="Decorative background video" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1" aria-hidden="true"></iframe>`;
  }

  const videoUrl = safeMediaUrl(attributes.videoUrl);
  if (!videoUrl) return poster;

  const posterAttribute = posterUrl ? ` poster="${escapeAttribute(posterUrl)}"` : "";
  return `<video class="wp-block-getquick-design-video-hero__video" src="${escapeAttribute(videoUrl)}"${posterAttribute} autoplay muted loop playsinline preload="metadata" aria-hidden="true"></video>`;
}

function rootSectionShell(html: string): string {
  const openingTag = html.match(/^\s*(<section\b[^>]*>)/i)?.[1];
  return openingTag ?? '<section class="wp-block-getquick-design-video-hero">';
}

function renderVideoHero(block: WordPressBlock, children: string): string {
  const openingTag = rootSectionShell(block.htmlContent ?? "");
  const attributes = block.attributes ?? {};
  const media = videoMarkup(attributes);

  return `${openingTag}<div class="wp-block-getquick-design-video-hero__media" aria-hidden="true">${media}</div><div class="wp-block-getquick-design-video-hero__content">${children}</div></section>`;
}

function appendChildren(html: string, children: string): string {
  if (!children) return html;
  const closingTag = html.lastIndexOf("</");
  if (closingTag < 0) return `${html}${children}`;
  return `${html.slice(0, closingTag)}${children}${html.slice(closingTag)}`;
}

function renderBlock(block: WordPressBlock, parentContainerHtml = ""): string {
  const isContainer = block.name === "getquick-design/container";
  let html = isContainer
    ? containerLayoutHtml(block.htmlContent ?? "", block.attributes ?? {})
    : (block.htmlContent ?? "");
  if (isContainer && parentContainerHtml) {
    html = containerChildLayoutHtml(html, parentContainerHtml);
  }
  const children = (block.innerBlocks ?? [])
    .map((child) => renderBlock(child, isContainer ? html : ""))
    .join("");

  if (block.name === VIDEO_HERO_BLOCK) return renderVideoHero(block, children);

  if (!children || BLOCKS_WITH_RENDERED_CHILDREN.has(block.name)) return html;
  return appendChildren(html, children);
}

export function renderWordPressBlocks(blocks: WordPressBlock[]): string {
  return blocks.map((block) => renderBlock(block)).join("");
}
