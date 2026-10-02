// Published-content delivery: what visitors are served, and what a trusted
// refresh may promote. The deployed Frontend serves the front page, the
// entries (published pages and posts) and the site chrome from the
// publication store (publications.ts), with the shared design presets when it
// holds them. A refresh reads the CMS (wordpress.ts)
// and promotes only what it read completely and validly; a visit reads it
// only to look up an entry the store has never held. Last-known-good content
// has no age limit: it is served until a refresh replaces it, or the CMS
// withdraws it (withdrawEntry): then it is a 404, and no read promotes it
// again until a later publication lifts the withdrawal.
import { z } from "astro/zod";
import {
  publicationStore,
  StoreFailure,
  type PublicationEvent,
  type PublicationStore,
  type Promotion,
  type StoredPublication,
  type Unusable,
} from "./publications";
import { frontendBindings } from "./runtime";
import {
  getDesignPresets,
  getEntryByUri,
  getHomeContent,
  getPublishedRoutes,
  getSiteChrome,
  type CmsFailureReason,
  type Delivery,
  type DesignPresets,
  type EntryContent,
  type Found,
  type HomeContent,
  type Missing,
  type SiteChrome,
} from "./wordpress";

/** The front page as stored: what WordPress delivered, without read details. */
export type HomePublication = Omit<HomeContent, "blocksOmitted" | "nodeId">;

/** A published page or post as stored, with the design presets it was read with. */
export type EntryPublication = Omit<EntryContent, "blocksOmitted" | "modifiedAt">;

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
/** The design presets every page is served with, once a refresh has stored them. */
const DESIGN = "design";
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
const designPresets = z.object({ spacingSizes, colors });

const parseWith = (schema: z.ZodType) => (body: unknown) => {
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
};
const parseHome = parseWith(homePublication) as (body: unknown) => HomePublication | undefined;
const parseChrome = parseWith(siteChrome) as (body: unknown) => SiteChrome | undefined;
const parseEntry = parseWith(entryPublication) as (body: unknown) => EntryPublication | undefined;
const parseDesign = parseWith(designPresets) as (body: unknown) => DesignPresets | undefined;

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
 * The stored shared design presets, or null without them: a Site last
 * refreshed before they were stored apart serves each page with the presets
 * it was read with, as does one whose stored presets this Frontend can't read.
 */
function sharedDesign(stored: StoredPublication<DesignPresets> | Unusable | null) {
  if (stored?.state === "unusable") {
    console.error(`Delivery: the shared design presets can't be served: ${stored.message}`);
  }
  return stored?.state === "published" ? stored.content : null;
}

/** A page's content with the shared design presets, when they are stored. */
function withDesign<T extends DesignPresets>(content: T, design: DesignPresets | null): T {
  return design
    ? { ...content, spacingSizes: design.spacingSizes, colors: design.colors }
    : content;
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

  let home, chrome, design;
  try {
    [home, chrome, design] = await Promise.all([
      store.read(HOME, parseHome),
      store.read(CHROME, parseChrome),
      store.read(DESIGN, parseDesign),
    ]);
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
    return notServed("the front page", "store", error.message);
  }

  if (home?.state === "unusable") return notServed("the front page", "not-ready", home.message);
  if (chrome?.state === "unusable") return notServed("the front page", "not-ready", chrome.message);
  const storedChrome = chrome?.state === "published" ? chrome.content : null;
  if (home?.state === "missing" || home?.state === "withdrawn") {
    return { kind: "missing", chrome: storedChrome };
  }
  if (home?.state !== "published" || !storedChrome) {
    return notServed(
      "the front page",
      "not-ready",
      "the front page and its chrome haven't been refreshed into the publication store yet",
    );
  }
  return {
    kind: "found",
    content: { home: withDesign(home.content, sharedDesign(design)), chrome: storedChrome },
  };
}

async function liveHome(siteOrigin?: string): Promise<HomeDelivery> {
  const [home, chrome] = await Promise.all([getHomeContent(), getSiteChrome(siteOrigin)]);
  const liveChrome = chrome.kind === "found" ? chrome.content : null;
  if (home.kind === "unavailable") return home;
  if (home.kind === "missing") return { kind: "missing", chrome: liveChrome };
  const { blocksOmitted: _, nodeId: __, ...content } = home.content;
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

  let entry, chrome, design;
  try {
    [entry, chrome, design] = await Promise.all([
      store.read(entryKey(route), parseEntry),
      store.read(CHROME, parseChrome),
      store.read(DESIGN, parseDesign),
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
  const found = (content: EntryPublication): EntryDelivery => ({
    kind: "found",
    content: { entry: withDesign(content, sharedDesign(design)), chrome: chrome.content },
  });
  if (!entry) {
    const looked = await lookUpEntry(store, route, chrome.content);
    return looked.kind === "found" ? found(looked.content.entry) : looked;
  }
  switch (entry.state) {
    case "unusable":
      return notServed(subject, "not-ready", entry.message);
    case "missing":
    case "withdrawn":
      return { kind: "missing", chrome: chrome.content };
    case "moved":
      return { kind: "moved", uri: entry.uri };
    case "published":
      return found(entry.content);
  }
}

/**
 * The cold path: an entry the store has never held is read from the CMS, the
 * one read a visit makes. Published and complete, it is promoted and served.
 * Confirmed missing is a 404 and stores nothing, since anyone can make up a
 * URL. A CMS failure is a 503: an empty store says nothing about whether the
 * entry exists. An entry WordPress keeps at another URI redirects there. One
 * whose withdrawal is in force is a 404, whatever WordPress still returns.
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
  if (promoted.outcome.outcome === "withdrawn") return { kind: "missing", chrome };
  await supersedeMoved(store, promoted.found ? [promoted.found] : [], readStartedAt);
  const { blocksOmitted: _, modifiedAt: __, ...entry } = read.content;
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
  const { blocksOmitted: _, modifiedAt: __, ...entry } = read.content;
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
 * where WordPress keeps an entry requested at another route. "withdrawn": the
 * read found an entry whose withdrawal is in force, so nothing was promoted.
 */
export type RecordOutcome =
  | { outcome: "promoted" | "superseded"; state: "published" | "missing" | "moved"; uri?: string }
  | { outcome: "withdrawn" }
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
  design: RecordOutcome;
  routes: RoutesOutcome;
}

/**
 * Refreshes the whole Site, the explicit preparation of its store: the front
 * page, the chrome, the shared design presets, and every entry WordPress lists as published or the store
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
  const [home, chrome, design, listing] = await Promise.all([
    getHomeContent(),
    getSiteChrome(siteOrigin),
    getDesignPresets(),
    getPublishedRoutes(),
  ]);

  const homeOutcome = await promoteHome(store, home, readStartedAt);
  const chromeOutcome = await promoteShared(store, CHROME, chrome, readStartedAt);
  const designOutcome = await promoteShared(store, DESIGN, design, readStartedAt);

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
      (storedHome?.state === "missing" ||
        storedHome?.state === "withdrawn" ||
        usable(storedChrome)?.state === "published");
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
  }
  return {
    ready,
    refreshed:
      homeOutcome.outcome !== "kept" &&
      chromeOutcome.outcome !== "kept" &&
      designOutcome.outcome !== "kept" &&
      routes.outcome === "listed" &&
      entries.refreshed,
    home: homeOutcome,
    chrome: chromeOutcome,
    design: designOutcome,
    routes,
    entries: entries.entries,
    moved: entries.moved,
  };
}

/** What a shared setting's change refreshes: the rows every affected page is served with. */
export type SharedPart = "home" | "chrome" | "design";

export interface SharedRefreshReport {
  /** Whether every part was promoted (or superseded by a newer read). */
  refreshed: boolean;
  home?: RecordOutcome;
  chrome?: RecordOutcome;
  design?: RecordOutcome;
}

/**
 * Refreshes shared settings: the chrome (menu, logo, icon), the shared design
 * presets, or the front page (which holds the site's title and tagline).
 * Every page is served with the stored chrome and design, so promoting them
 * reaches every page at once, without reading the entries again. Each part is
 * promoted only from a complete, valid read; a failed one keeps what is
 * stored, so a failed read never erases navigation, branding or design.
 */
export async function refreshShared(
  store: PublicationStore,
  parts: SharedPart[],
  siteOrigin?: string,
): Promise<SharedRefreshReport> {
  const readStartedAt = Date.now();
  const wanted = new Set(parts);
  const [home, chrome, design] = await Promise.all([
    wanted.has("home") ? getHomeContent() : undefined,
    wanted.has("chrome") ? getSiteChrome(siteOrigin) : undefined,
    wanted.has("design") ? getDesignPresets() : undefined,
  ]);
  const report: SharedRefreshReport = { refreshed: true };
  if (home) report.home = await promoteHome(store, home, readStartedAt);
  if (chrome) report.chrome = await promoteShared(store, CHROME, chrome, readStartedAt);
  if (design) report.design = await promoteShared(store, DESIGN, design, readStartedAt);
  report.refreshed = [report.home, report.chrome, report.design].every(
    (outcome) => outcome?.outcome !== "kept",
  );
  return report;
}

/** What reconciliation did with a shared row: refreshed it (or failed to), or found it unchanged. */
export type SharedOutcome = RecordOutcome | { outcome: "unchanged" };

export interface SharedReconciliation {
  home: SharedOutcome;
  chrome: SharedOutcome;
  design: SharedOutcome;
}

/**
 * Reconciles the shared rows with WordPress: reads the front page (with the
 * site's title and tagline), the chrome and the design presets, compares each
 * read with what is stored, and promotes the ones that differ, by the same
 * rules as any refresh. A failed read keeps what is stored. Comparing what
 * WordPress returns, rather than asking it what changed, catches a change to
 * any shared setting, whatever saved it.
 */
export async function reconcileShared(
  store: PublicationStore,
  siteOrigin?: string,
): Promise<SharedReconciliation> {
  const readStartedAt = Date.now();
  const [home, chrome, design] = await Promise.all([
    getHomeContent(),
    getSiteChrome(siteOrigin),
    getDesignPresets(),
  ]);
  const unchanged = async <T>(
    key: string,
    parse: (body: unknown) => T | undefined,
    read: { state: "published"; content: unknown } | { state: "missing" } | null,
  ) => {
    if (!read) return false;
    try {
      const stored = await store.read(key, parse);
      if (!stored || stored.state !== read.state) return false;
      return (
        stored.state !== "published" ||
        ("content" in read && canonicalJson(stored.content) === canonicalJson(read.content))
      );
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      return false;
    }
  };

  let homeRead: { state: "published"; content: HomePublication } | { state: "missing" } | null =
    null;
  if (home.kind === "missing") homeRead = { state: "missing" };
  if (home.kind === "found" && !home.content.blocksOmitted) {
    const { blocksOmitted: _, nodeId: __, ...content } = home.content;
    homeRead = { state: "published", content };
  }
  const sharedRead = (read: typeof chrome | typeof design) =>
    read.kind === "found" ? ({ state: "published", content: read.content } as const) : null;

  return {
    home: (await unchanged(HOME, parseHome, homeRead))
      ? { outcome: "unchanged" }
      : await promoteHome(store, home, readStartedAt),
    chrome: (await unchanged(CHROME, parseChrome, sharedRead(chrome)))
      ? { outcome: "unchanged" }
      : await promoteShared(store, CHROME, chrome, readStartedAt),
    design: (await unchanged(DESIGN, parseDesign, sharedRead(design)))
      ? { outcome: "unchanged" }
      : await promoteShared(store, DESIGN, design, readStartedAt),
  };
}

/** JSON with its object keys sorted, so two equal values compare equal. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : item,
  );
}

/** Promotes a read of a shared row: the chrome, or the design presets. */
function promoteShared(
  store: PublicationStore,
  key: typeof CHROME | typeof DESIGN,
  read: Found<SiteChrome | DesignPresets> | { kind: "unavailable"; failure: RefreshFailure },
  readStartedAt: number,
) {
  const subject = key === CHROME ? "the site chrome" : "the shared design presets";
  const parse = (key === CHROME ? parseChrome : parseDesign) as (body: unknown) => unknown;
  return promoteRead(store, key, subject, readStartedAt, parse, () =>
    read.kind === "found" ? { state: "published", content: read.content } : read.failure,
  );
}

/**
 * Refreshes the front page only (not the chrome or the entries): the front
 * page itself was published or changed.
 */
export async function refreshHome(store: PublicationStore): Promise<RecordOutcome> {
  const readStartedAt = Date.now();
  return promoteHome(store, await getHomeContent(), readStartedAt);
}

function promoteHome(store: PublicationStore, home: Delivery<HomeContent>, readStartedAt: number) {
  return promoteRead(store, HOME, "the front page", readStartedAt, parseHome, () => {
    if (home.kind === "unavailable") return home.failure;
    if (home.kind === "missing") return { state: "missing" };
    const { blocksOmitted, nodeId, ...content } = home.content;
    if (blocksOmitted) {
      return {
        reason: "partial",
        message: "WordPress could only return the front page without its blocks",
      };
    }
    return { state: "published", content, ...(nodeId ? { nodeId } : {}) };
  });
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
  const { blocksOmitted, modifiedAt, ...entry } = read.content;
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
    const outcome = await promote(route, () => moved);
    if (outcome.outcome === "withdrawn") return { outcome };
    return { outcome, found: { nodeId: entry.id, route: "/" } };
  }
  const outcome = await promote(canonical, () => ({
    state: "published",
    content: entry,
    nodeId: entry.id,
    modifiedAt,
  }));
  if (outcome.outcome === "kept" || outcome.outcome === "withdrawn") return { outcome };
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

/** Runs work on each item, at most `limit` at a time; resolves to the results in order. */
export async function eachLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
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
        promoted === "withdrawn"
          ? { outcome: "withdrawn" }
          : result.state === "moved"
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
  } else if (outcome.outcome === "withdrawn") {
    console.info(`Refresh: ${subject} isn't promoted: its entry is withdrawn`);
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
        : outcome.outcome === "withdrawn"
          ? { outcome: "superseded", reason: "withdrawn" }
          : { outcome: outcome.outcome },
    );
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
    console.error(`Refresh: ${subject}'s outcome couldn't be recorded: ${error.message}`);
  }
  return outcome;
}

export interface WithdrawalReport {
  status: "withdrawn" | "superseded";
  /** The routes now withdrawn (`/` for the front page). */
  withdrawn: string[];
  /** The later event that already won, when it is known. */
  by?: string;
}

/**
 * Withdraws a page or post the CMS unpublished, made private or
 * password-protected, trashed or deleted, without reading the CMS: every
 * route the store holds it at (served or redirecting) and the URI it was
 * withdrawn at become a 404 at once, and stay one through outages, restarts,
 * fallbacks, delayed or duplicate events and older in-flight reads, since no
 * read promotes it again while the withdrawal is in force. A route holding
 * another entry is left alone. A publication that happened later wins over
 * it, before or after.
 */
export async function withdrawEntry(
  store: PublicationStore,
  event: PublicationEvent,
): Promise<WithdrawalReport> {
  const route = routeOf(event.uri);
  const outcome = await store.withdraw(event, route === "/" ? HOME : entryKey(route), Date.now());
  if (outcome.status === "superseded") {
    console.info(
      `Withdrawal: ${event.id} for ${route} is superseded${outcome.by ? ` by the later ${outcome.by}` : ""}`,
    );
    return { status: "superseded", withdrawn: [], ...(outcome.by ? { by: outcome.by } : {}) };
  }
  const withdrawn = outcome.keys.map((key) => (key === HOME ? "/" : key.slice(ENTRY.length)));
  console.info(`Withdrawal: ${event.id} withdrew ${withdrawn.join(", ") || "nothing stored"}`);
  return { status: "withdrawn", withdrawn };
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
