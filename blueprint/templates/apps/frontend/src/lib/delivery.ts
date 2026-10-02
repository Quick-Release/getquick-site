// Published-content delivery: what visitors are served, and what a trusted
// refresh may promote. The deployed Frontend serves the front page, the
// entries (published pages and posts) and the site chrome from the
// publication store (publications.ts). A refresh reads the CMS (wordpress.ts)
// and promotes only what it read completely and validly; a visit reads it
// only to look up an entry the store has never held. Last-known-good content
// has no age limit: it is served until a refresh replaces it.
import { z } from "astro/zod";
import {
  publicationStore,
  StoreFailure,
  type PublicationStore,
  type Promotion,
  type StoredPublication,
  type Unusable,
} from "./publications";
import { frontendBindings } from "./runtime";
import {
  getEntryByUri,
  getHomeContent,
  getPublishedRoutes,
  getSiteChrome,
  type CmsFailureReason,
  type Delivery,
  type EntryContent,
  type Found,
  type HomeContent,
  type Missing,
  type SiteChrome,
} from "./wordpress";

/** The front page as stored: what WordPress delivered, without read details. */
export type HomePublication = Omit<HomeContent, "blocksOmitted">;

/** A published page or post as stored, with the design presets it was read with. */
export type EntryPublication = Omit<EntryContent, "blocksOmitted">;

export interface HomePage {
  home: HomePublication;
  chrome: SiteChrome;
}

export interface EntryPage {
  entry: EntryPublication;
  chrome: SiteChrome;
}

/** The entry a route served is published at another URI now: the route redirects there. */
export interface Moved {
  kind: "moved";
  uri: string;
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

export type EntryDelivery =
  | Found<EntryPage>
  | (Missing & { chrome: SiteChrome | null })
  | Moved
  | NotServed;

const HOME = "home";
const CHROME = "chrome";
/** Entries are stored at "entry:<route>". */
const ENTRY = "entry:";
const entryKey = (route: string) => `${ENTRY}${route}`;

/**
 * A path as entries are keyed: percent-decoded and between slashes, so
 * WordPress's `/caf%c3%a9/` and a browser's `/caf%C3%A9` are one route.
 */
export function routeOf(path: string) {
  let route = path;
  try {
    route = decodeURI(path);
  } catch {
    // Not percent-encoded validly; WordPress has no such URI, so keep it as is.
  }
  if (!route.startsWith("/")) route = `/${route}`;
  return route.endsWith("/") ? route : `${route}/`;
}

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
const spacingSizes = z.array(z.object({ slug: z.string(), size: z.string() }));
const colors = z.array(z.object({ slug: z.string(), color: z.string() }));
const homePublication = z.object({
  settings: z.object({ title: z.string(), description: z.string() }),
  page: z.object({ title: z.string(), content: z.string(), hasVideoHero: z.boolean() }),
  spacingSizes,
  colors,
});
const entryPublication = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: z.string(),
  content: z.string(),
  uri: z.string(),
  date: z.string(),
  featuredImage: image,
  hasVideoHero: z.boolean(),
  spacingSizes,
  colors,
});
const siteChrome = z.object({ menuItems: z.array(menuItem), siteIcon: image, siteLogo: image });

const parseWith = (schema: z.ZodType) => (body: unknown) => {
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
};
const parseHome = parseWith(homePublication) as (body: unknown) => HomePublication | undefined;
const parseChrome = parseWith(siteChrome) as (body: unknown) => SiteChrome | undefined;
const parseEntry = parseWith(entryPublication) as (body: unknown) => EntryPublication | undefined;

const emptyChrome: SiteChrome = { menuItems: [], siteIcon: null, siteLogo: null };

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
  if (home?.state !== "published" || !storedChrome) {
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
  return { kind: "found", content: { home: content, chrome: liveChrome ?? emptyChrome } };
}

/**
 * The published page or post at a path, with the chrome, from the store. A
 * stored entry is served without reading the CMS, through outages of any
 * length; one confirmed missing is a 404, one moved redirects. An entry the
 * store has never held is looked up (lookUpEntry). The store holds nothing to
 * serve entries with until a refresh has stored the chrome: not ready.
 */
export async function publishedEntry(path: string, siteOrigin?: string): Promise<EntryDelivery> {
  const route = routeOf(path);
  const subject = `the entry ${route}`;
  const store = await boundStore();
  if (!store) {
    if (import.meta.env.DEV) return liveEntry(route, siteOrigin);
    return notServed(
      subject,
      "not-ready",
      "this Frontend has no publication store bound (PUBLICATION_DB)",
    );
  }

  let entry, chrome;
  try {
    [entry, chrome] = await Promise.all([
      store.read(entryKey(route), parseEntry),
      store.read(CHROME, parseChrome),
    ]);
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
    return notServed(subject, "store", error.message);
  }

  if (chrome?.state === "unusable") return notServed(subject, "not-ready", chrome.message);
  if (chrome?.state !== "published") {
    return notServed(
      subject,
      "not-ready",
      "the site chrome hasn't been refreshed into the publication store yet",
    );
  }
  if (!entry) return lookUpEntry(store, route, chrome.content);
  switch (entry.state) {
    case "unusable":
      return notServed(subject, "not-ready", entry.message);
    case "missing":
      return { kind: "missing", chrome: chrome.content };
    case "moved":
      return { kind: "moved", uri: entry.uri };
    case "published":
      return { kind: "found", content: { entry: entry.content, chrome: chrome.content } };
  }
}

/**
 * The cold path: an entry the store has never held is read from the CMS, the
 * one read a visit makes. Published and complete, it is promoted and served.
 * Confirmed missing is a 404 and stores nothing, since anyone can make up a
 * URL. A CMS failure is a 503: an empty store says nothing about whether the
 * entry exists. An entry WordPress keeps at another URI redirects there.
 */
async function lookUpEntry(
  store: PublicationStore,
  route: string,
  chrome: SiteChrome,
): Promise<EntryDelivery> {
  const readStartedAt = Date.now();
  const read = await getEntryByUri(encodeURI(route));
  if (read.kind === "unavailable") return read;
  if (read.kind === "missing") return { kind: "missing", chrome };
  const canonical = routeOf(read.content.uri);
  if (canonical !== route) return { kind: "moved", uri: canonical };

  const promoted = await promoteEntry(store, route, read, readStartedAt);
  await supersedeMoved(store, promoted.found ? [promoted.found] : [], readStartedAt);
  const { blocksOmitted: _, ...entry } = read.content;
  return { kind: "found", content: { entry, chrome } };
}

async function liveEntry(route: string, siteOrigin?: string): Promise<EntryDelivery> {
  const [read, chrome] = await Promise.all([
    getEntryByUri(encodeURI(route)),
    getSiteChrome(siteOrigin),
  ]);
  const liveChrome = chrome.kind === "found" ? chrome.content : null;
  if (read.kind === "unavailable") return read;
  if (read.kind === "missing") return { kind: "missing", chrome: liveChrome };
  const { blocksOmitted: _, ...entry } = read.content;
  return { kind: "found", content: { entry, chrome: liveChrome ?? emptyChrome } };
}

/**
 * The menu, logo and icon for a page that isn't a publication (one the site
 * adds itself): the stored chrome when there is a store, else a live read.
 * Null when neither has them; the page is then served without them.
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

interface RefreshFailure {
  reason: RefreshFailureReason;
  message: string;
}

/**
 * What a refresh did with one row. `uri` is where a moved row now points, or
 * where WordPress keeps an entry requested at another route.
 */
export type RecordOutcome =
  | { outcome: "promoted" | "superseded"; state: "published" | "missing" | "moved"; uri?: string }
  | { outcome: "kept"; failure: RefreshFailure };

/** Whether WordPress listed every published route, and how many. */
export type RoutesOutcome =
  | { outcome: "listed"; count: number }
  | { outcome: "failed"; failure: RefreshFailure };

export interface EntriesRefreshReport {
  /** Whether every read was promoted (or superseded by a newer one). */
  refreshed: boolean;
  /** Each refreshed route's outcome. */
  entries: Record<string, RecordOutcome>;
  /** Routes whose entry was found at another URI, and that URI. */
  moved: Record<string, string>;
}

export interface RefreshReport extends EntriesRefreshReport {
  /** Whether the front page can be served from the store after this refresh. */
  ready: boolean;
  home: RecordOutcome;
  chrome: RecordOutcome;
  routes: RoutesOutcome;
}

/**
 * Refreshes the whole Site, the explicit preparation of its store: the front
 * page, the chrome, and every entry WordPress lists as published or the store
 * already holds (so one deleted or moved since is reconciled). Each read that
 * is complete and valid is promoted; a failed one keeps what is stored, so a
 * failed chrome read doesn't touch the front page or the entries, nor the
 * reverse. Reads are anonymous, as a visitor's would be, so only published
 * content can enter the store.
 */
export async function refreshSite(
  store: PublicationStore,
  siteOrigin?: string,
): Promise<RefreshReport> {
  const readStartedAt = Date.now();
  const [home, chrome, listing] = await Promise.all([
    getHomeContent(),
    getSiteChrome(siteOrigin),
    getPublishedRoutes(),
  ]);

  const homeOutcome = await promoteRead(
    store,
    HOME,
    "the front page",
    readStartedAt,
    parseHome,
    () => {
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
    },
  );
  const chromeOutcome = await promoteRead(
    store,
    CHROME,
    "the site chrome",
    readStartedAt,
    parseChrome,
    () =>
      chrome.kind === "found" ? { state: "published", content: chrome.content } : chrome.failure,
  );

  let stored: string[] = [];
  let routes: RoutesOutcome =
    listing.kind === "found"
      ? { outcome: "listed", count: listing.content.length }
      : { outcome: "failed", failure: listing.failure };
  try {
    stored = (await store.keys(ENTRY)).map((key) => key.slice(ENTRY.length));
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
    if (routes.outcome === "listed") {
      routes = { outcome: "failed", failure: { reason: "store", message: error.message } };
    }
  }
  if (routes.outcome === "failed") {
    console.error(
      `Refresh: the published routes couldn't be listed (${routes.failure.reason}): ${routes.failure.message}`,
    );
  }
  const listed = listing.kind === "found" ? listing.content.map(routeOf) : [];
  // The front page is the homepage's, never an entry.
  const wanted = [...new Set([...listed, ...stored])].filter((route) => route !== "/");
  const entries = await refreshRoutes(store, wanted, readStartedAt);

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
    refreshed:
      homeOutcome.outcome !== "kept" &&
      chromeOutcome.outcome !== "kept" &&
      routes.outcome === "listed" &&
      entries.refreshed,
    home: homeOutcome,
    chrome: chromeOutcome,
    routes,
    entries: entries.entries,
    moved: entries.moved,
  };
}

/**
 * Refreshes the entries at these paths only: a new publication, a changed
 * one, or the route one left. An entry found at another URI than before is
 * promoted there, and the routes that served it redirect to it.
 */
export async function refreshEntries(
  store: PublicationStore,
  paths: string[],
): Promise<EntriesRefreshReport> {
  const readStartedAt = Date.now();
  return refreshRoutes(store, [...new Set(paths.map(routeOf))], readStartedAt);
}

async function refreshRoutes(
  store: PublicationStore,
  routes: string[],
  refreshStartedAt: number,
): Promise<EntriesRefreshReport> {
  const reads = await eachLimited(routes, 4, async (route) => {
    const readStartedAt = Date.now();
    return { route, readStartedAt, read: await getEntryByUri(encodeURI(route)) };
  });

  // Found and failed reads first. Then the routes still serving an entry
  // found elsewhere are marked moved, including one WordPress now confirms
  // missing: its visitors are redirected rather than shown a 404. Only then
  // is the rest that is confirmed missing promoted.
  const outcomes = new Map<string, RecordOutcome>();
  const found: Array<{ nodeId: string; route: string }> = [];
  for (const { route, readStartedAt, read } of reads) {
    if (read.kind === "missing") continue;
    const promoted = await promoteEntry(store, route, read, readStartedAt, true);
    outcomes.set(route, promoted.outcome);
    if (promoted.found) found.push(promoted.found);
  }
  const { moved, failed } = await supersedeMoved(store, found, refreshStartedAt);
  for (const { route, readStartedAt, read } of reads) {
    if (read.kind !== "missing") continue;
    outcomes.set(
      route,
      moved[route]
        ? { outcome: "promoted", state: "moved", uri: moved[route] }
        : (await promoteEntry(store, route, read, readStartedAt)).outcome,
    );
  }

  const entries = Object.fromEntries(routes.map((route) => [route, outcomes.get(route)!]));
  return {
    refreshed: !failed && Object.values(entries).every((outcome) => outcome.outcome !== "kept"),
    entries,
    moved,
  };
}

interface EntryPromotion {
  outcome: RecordOutcome;
  /** The entry the read found, at its own route, when it was stored there. */
  found?: { nodeId: string; route: string };
}

/**
 * Promotes one entry read. A found entry is stored at the route WordPress
 * gives it, never at a route it was only requested at: with `recordAlias`
 * (an explicit refresh of that route), the requested route is stored as
 * moved to it. The front page is the homepage's, so a route that resolves to
 * it moves to `/`.
 */
async function promoteEntry(
  store: PublicationStore,
  route: string,
  read: Delivery<EntryContent>,
  readStartedAt: number,
  recordAlias = false,
): Promise<EntryPromotion> {
  const promote = (at: string, result: () => ReadResult<EntryPublication>) =>
    promoteRead(store, entryKey(at), `the entry ${at}`, readStartedAt, parseEntry, result);

  if (read.kind !== "found") {
    return {
      outcome: await promote(route, () =>
        read.kind === "missing" ? { state: "missing" } : read.failure,
      ),
    };
  }
  const { blocksOmitted, ...entry } = read.content;
  if (blocksOmitted) {
    return {
      outcome: await promote(route, () => ({
        reason: "partial",
        message: `WordPress could only return the entry ${route} without its blocks`,
      })),
    };
  }

  const canonical = routeOf(entry.uri);
  const moved = { state: "moved" as const, uri: canonical, nodeId: entry.id };
  if (canonical === "/") {
    return { outcome: await promote(route, () => moved), found: { nodeId: entry.id, route: "/" } };
  }
  const outcome = await promote(canonical, () => ({
    state: "published",
    content: entry,
    nodeId: entry.id,
  }));
  if (outcome.outcome === "kept") return { outcome };
  const found = { nodeId: entry.id, route: canonical };
  if (canonical === route) return { outcome, found };
  if (!recordAlias) return { outcome: { ...outcome, uri: canonical }, found };
  return { outcome: await promote(route, () => moved), found };
}

/**
 * Every other route still serving an entry that was just found at its own
 * route is marked moved there, unless it was read since `readBefore`: a
 * renamed page's old route stops presenting its superseded copy.
 */
async function supersedeMoved(
  store: PublicationStore,
  found: Array<{ nodeId: string; route: string }>,
  readBefore: number,
) {
  const moved: Record<string, string> = {};
  let failed = false;
  for (const { nodeId, route } of found) {
    try {
      const keys = await store.supersede(nodeId, route, entryKey(route), readBefore);
      for (const key of keys) {
        const from = key.slice(ENTRY.length);
        moved[from] = route;
        console.info(`Refresh: the entry ${from} moved to ${route}`);
      }
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      failed = true;
      console.error(
        `Refresh: the routes the entry ${route} left couldn't be reconciled: ${error.message}`,
      );
    }
  }
  return { moved, failed };
}

async function eachLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type ReadResult<T> = Promotion<T> | RefreshFailure;

/**
 * Promotes a read unless it failed, or its content wouldn't be readable back
 * from the store by this Frontend (so nothing the renderer can't serve is
 * accepted), and records the outcome.
 */
async function promoteRead<T>(
  store: PublicationStore,
  key: string,
  subject: string,
  readStartedAt: number,
  parse: (body: unknown) => T | undefined,
  read: () => ReadResult<T>,
): Promise<RecordOutcome> {
  let result = read();
  if (
    "state" in result &&
    result.state === "published" &&
    parse(JSON.parse(JSON.stringify(result.content))) === undefined
  ) {
    result = { reason: "schema", message: `${subject} isn't in a shape this Frontend can serve` };
  }
  let outcome: RecordOutcome;
  if ("reason" in result) {
    outcome = { outcome: "kept", failure: { reason: result.reason, message: result.message } };
  } else {
    try {
      const promoted = await store.promote(key, result, readStartedAt);
      outcome =
        result.state === "moved"
          ? { outcome: promoted, state: "moved", uri: result.uri }
          : { outcome: promoted, state: result.state };
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
    console.info(
      `Refresh: ${subject} ${outcome.outcome} (${outcome.state}${outcome.uri ? ` to ${outcome.uri}` : ""})`,
    );
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
