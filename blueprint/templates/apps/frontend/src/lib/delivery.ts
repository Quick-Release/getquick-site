// Published-content delivery: what visitors are served, and what a trusted
// refresh may promote. The deployed Frontend serves the front page and the
// site chrome from the publication store (publications.ts), never from a
// visitor's CMS read; only a refresh reads the CMS (wordpress.ts), and it
// promotes only what it read completely and validly. Last-known-good content
// has no age limit: it is served until a refresh replaces it.
import { z } from "astro/zod";
import {
  publicationStore,
  StoreFailure,
  type PublicationStore,
  type StoredPublication,
  type Unusable,
} from "./publications";
import { frontendBindings } from "./runtime";
import {
  getHomeContent,
  getSiteChrome,
  type CmsFailureReason,
  type Found,
  type HomeContent,
  type Missing,
  type SiteChrome,
} from "./wordpress";

/** The front page as stored: what WordPress delivered, without read details. */
export type HomePublication = Omit<HomeContent, "blocksOmitted">;

export interface HomePage {
  home: HomePublication;
  chrome: SiteChrome;
}

/**
 * Why there is nothing to serve: the CMS failed (live reads, in `astro dev`),
 * the store couldn't be read (`store`), or the Site has never been refreshed,
 * or holds only state this Frontend can't read (`not-ready`).
 */
export type DeliveryFailureReason = CmsFailureReason | "store" | "not-ready";

export interface NotServed {
  kind: "unavailable";
  failure: { reason: DeliveryFailureReason; message: string };
}

export type HomeDelivery = Found<HomePage> | (Missing & { chrome: SiteChrome | null }) | NotServed;

const HOME = "home";
const CHROME = "chrome";

// The stored shapes. A body that doesn't parse is unusable, not served.
const image = z.object({ sourceUrl: z.string(), altText: z.string() }).nullable();
interface StoredMenuItem {
  id: string;
  label: string;
  href: string;
  target: string | null;
  children: StoredMenuItem[];
}
const menuItem: z.ZodType<StoredMenuItem> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    href: z.string(),
    target: z.string().nullable(),
    children: z.array(menuItem),
  }),
);
const homePublication = z.object({
  settings: z.object({ title: z.string(), description: z.string() }),
  page: z.object({ title: z.string(), content: z.string(), hasVideoHero: z.boolean() }),
  spacingSizes: z.array(z.object({ slug: z.string(), size: z.string() })),
  colors: z.array(z.object({ slug: z.string(), color: z.string() })),
});
const siteChrome = z.object({ menuItems: z.array(menuItem), siteIcon: image, siteLogo: image });

const parseWith = (schema: z.ZodType) => (body: unknown) => {
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
};
const parseHome = parseWith(homePublication) as (body: unknown) => HomePublication | undefined;
const parseChrome = parseWith(siteChrome) as (body: unknown) => SiteChrome | undefined;

async function boundStore(): Promise<PublicationStore | null> {
  const { PUBLICATION_DB } = await frontendBindings();
  return PUBLICATION_DB ? publicationStore(PUBLICATION_DB) : null;
}

function notServed(subject: string, reason: DeliveryFailureReason, message: string): NotServed {
  console.error(`Delivery: ${subject} can't be served (${reason}): ${message}`);
  return { kind: "unavailable", failure: { reason, message } };
}

function usable<T>(stored: StoredPublication<T> | Unusable | null) {
  return stored && stored.state !== "unusable" ? stored : null;
}

/**
 * The front page and its chrome, from the store. Outside the deployed Worker
 * there is no store: `astro dev` reads the CMS live, and a production build
 * without one is not ready rather than a CMS reader for every visitor.
 */
export async function publishedHome(siteOrigin?: string): Promise<HomeDelivery> {
  const store = await boundStore();
  if (!store) {
    if (import.meta.env.DEV) return liveHome(siteOrigin);
    return notServed(
      "the front page",
      "not-ready",
      "this Frontend has no publication store bound (PUBLICATION_DB)",
    );
  }

  let home, chrome;
  try {
    [home, chrome] = await Promise.all([
      store.read(HOME, parseHome),
      store.read(CHROME, parseChrome),
    ]);
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
    return notServed("the front page", "store", error.message);
  }

  if (home?.state === "unusable") return notServed("the front page", "not-ready", home.message);
  if (chrome?.state === "unusable") return notServed("the front page", "not-ready", chrome.message);
  const storedChrome = chrome?.state === "published" ? chrome.content : null;
  if (home?.state === "missing") return { kind: "missing", chrome: storedChrome };
  if (!home || !storedChrome) {
    return notServed(
      "the front page",
      "not-ready",
      "the front page and its chrome haven't been refreshed into the publication store yet",
    );
  }
  return { kind: "found", content: { home: home.content, chrome: storedChrome } };
}

async function liveHome(siteOrigin?: string): Promise<HomeDelivery> {
  const [home, chrome] = await Promise.all([getHomeContent(), getSiteChrome(siteOrigin)]);
  const liveChrome = chrome.kind === "found" ? chrome.content : null;
  if (home.kind === "unavailable") return home;
  if (home.kind === "missing") return { kind: "missing", chrome: liveChrome };
  const { blocksOmitted: _, ...content } = home.content;
  return {
    kind: "found",
    content: {
      home: content,
      chrome: liveChrome ?? { menuItems: [], siteIcon: null, siteLogo: null },
    },
  };
}

/**
 * The menu, logo and icon for a page that isn't served from the store yet
 * (entries): the stored chrome when there is a store, else a live read. Null
 * when neither has them; the page is then served without them.
 */
export async function pageChrome(siteOrigin?: string): Promise<SiteChrome | null> {
  const store = await boundStore();
  if (!store) {
    const chrome = await getSiteChrome(siteOrigin);
    return chrome.kind === "found" ? chrome.content : null;
  }
  try {
    const stored = usable(await store.read(CHROME, parseChrome));
    return stored?.state === "published" ? stored.content : null;
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
    console.error(`Delivery: the site chrome can't be served (store): ${error.message}`);
    return null;
  }
}

export type RefreshFailureReason = CmsFailureReason | "partial" | "store";

export type RecordOutcome =
  | { outcome: "promoted" | "superseded"; state: "published" | "missing" }
  | { outcome: "kept"; failure: { reason: RefreshFailureReason; message: string } };

export interface RefreshReport {
  /** Whether the front page can be served from the store after this refresh. */
  ready: boolean;
  /** Whether every read was promoted (or superseded by a newer one). */
  refreshed: boolean;
  home: RecordOutcome;
  chrome: RecordOutcome;
}

/**
 * Reads the front page and the chrome from the CMS and promotes each one
 * that was read completely and validly. A failed read, including a front
 * page WordPress could only return without its blocks, keeps what is stored:
 * a failed chrome read doesn't touch the front page, nor the reverse. Reads
 * are anonymous, as a visitor's would be, so only published content can
 * enter the store.
 */
export async function refreshHomepage(
  store: PublicationStore,
  siteOrigin?: string,
): Promise<RefreshReport> {
  const readStartedAt = Date.now();
  const [home, chrome] = await Promise.all([getHomeContent(), getSiteChrome(siteOrigin)]);

  const homeOutcome = await promoteRead(store, HOME, "the front page", readStartedAt, () => {
    if (home.kind === "unavailable") return home.failure;
    if (home.kind === "missing") return { state: "missing" };
    const { blocksOmitted, ...content } = home.content;
    if (blocksOmitted) {
      return {
        reason: "partial",
        message: "WordPress could only return the front page without its blocks",
      };
    }
    return { state: "published", content };
  });
  const chromeOutcome = await promoteRead(store, CHROME, "the site chrome", readStartedAt, () =>
    chrome.kind === "found" ? { state: "published", content: chrome.content } : chrome.failure,
  );

  let ready = false;
  try {
    const [storedHome, storedChrome] = await Promise.all([
      store.read(HOME, parseHome),
      store.read(CHROME, parseChrome),
    ]);
    ready =
      usable(storedHome) !== null &&
      (storedHome?.state === "missing" || usable(storedChrome)?.state === "published");
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
  }
  return {
    ready,
    refreshed: homeOutcome.outcome !== "kept" && chromeOutcome.outcome !== "kept",
    home: homeOutcome,
    chrome: chromeOutcome,
  };
}

type ReadResult<T> =
  | { state: "published"; content: T }
  | { state: "missing" }
  | { reason: RefreshFailureReason; message: string };

async function promoteRead<T>(
  store: PublicationStore,
  key: string,
  subject: string,
  readStartedAt: number,
  read: () => ReadResult<T>,
): Promise<RecordOutcome> {
  const result = read();
  let outcome: RecordOutcome;
  if ("reason" in result) {
    outcome = { outcome: "kept", failure: { reason: result.reason, message: result.message } };
  } else {
    try {
      outcome = { outcome: await store.promote(key, result, readStartedAt), state: result.state };
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      outcome = { outcome: "kept", failure: { reason: "store", message: error.message } };
    }
  }

  if (outcome.outcome === "kept") {
    console.error(
      `Refresh: ${subject} kept its last stored version (${outcome.failure.reason}): ${outcome.failure.message}`,
    );
  } else {
    console.info(`Refresh: ${subject} ${outcome.outcome} (${outcome.state})`);
  }
  try {
    await store.recordAttempt(
      key,
      outcome.outcome === "kept"
        ? { outcome: "kept", reason: outcome.failure.reason, message: outcome.failure.message }
        : { outcome: outcome.outcome },
    );
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
    console.error(`Refresh: ${subject}'s outcome couldn't be recorded: ${error.message}`);
  }
  return outcome;
}

/** The refresh's credential when the Worker has one bound, and it is strong enough. */
export async function refreshAuthority(): Promise<
  { store: PublicationStore; token: string } | { refused: string }
> {
  const { PUBLICATION_DB, FRONTEND_REFRESH_TOKEN: token } = await frontendBindings();
  if (!PUBLICATION_DB) return { refused: "this Frontend has no publication store bound" };
  if (!token || token.length < 32) {
    return { refused: "this Frontend has no refresh token of 32 characters or more bound" };
  }
  return { store: publicationStore(PUBLICATION_DB), token };
}

/** Compares a request's bearer token with the bound one, in constant time. */
export async function isAuthorized(request: Request, token: string) {
  const presented = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [expected, actual] = await Promise.all([digest(token), digest(presented)]);
  let difference = presented ? 0 : 1;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index]! ^ actual[index]!;
  }
  return difference === 0;
}
