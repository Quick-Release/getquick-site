// The CMS's publication events (POST /gq/events): WordPress tells the Frontend
// a page or post was published or updated, and the Frontend refreshes it, so a
// publication reaches visitors without a deploy. An event is only a reason to
// refresh: what is promoted is what the refresh then reads from WordPress,
// anonymously, completely and validly (delivery.ts), never what the event says.
//
// Each event is signed by the Site's CMS with PUBLICATION_EVENT_SECRET, names
// this Site and has an identity and the time it happened. It is recorded
// before it is processed (publications.ts), so a duplicate is recognised, an
// event older than one already refreshed for the same entry is superseded
// rather than processed, and one whose refresh failed stays on record, failed,
// for a retry. Each action has its own handler: "publish" for a page or post,
// "settings" for a shared setting (menus, logo, site identity, design presets),
// and later withdrawals beside them.
import { z } from "astro/zod";
import {
  refreshEntries,
  refreshHome,
  refreshShared,
  routeOf,
  type RecordOutcome,
  type SharedPart,
} from "./delivery";
import {
  publicationStore,
  StoreFailure,
  type PublicationEvent,
  type PublicationStore,
} from "./publications";
import { frontendBindings } from "./runtime";

/** The Site this Frontend serves: events for any other are refused. */
export const SITE = "{{project}}";

/** How far an event's signing time may be from the Worker's clock. */
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
/** The largest event body read. */
const MAX_BODY_BYTES = 16 * 1024;

export interface EventAnswer {
  status: number;
  body: Record<string, unknown>;
}

const path = z
  .string()
  .max(2048)
  .regex(/^\/(?!\/)[^?#\s]*$/, "must be a path such as /about/");

const envelope = {
  site: z.string(),
  id: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/, "must be 8 to 64 letters, digits or hyphens (a UUID)"),
  occurredAt: z.number().int().positive(),
};

/** Proves the Frontend accepts this Site's events; changes nothing. */
const checkEvent = z.object({ ...envelope, action: z.literal("check") }).strict();

/** A page or post was published or updated (and, with previousUri, moved). */
const publishEvent = z
  .object({
    ...envelope,
    action: z.literal("publish"),
    entry: z
      .object({
        id: z.string().min(1).max(200),
        uri: path,
        previousUri: path.nullable().optional(),
      })
      .strict(),
  })
  .strict();

type PublishEvent = z.infer<typeof publishEvent>;

/**
 * The shared settings an event can name, and what each change refreshes: the
 * menus and the logo are in the chrome every page is served with; the site's
 * identity is its title and tagline (the front page's) and its icon (the
 * chrome's); the design presets are the shared design every page uses.
 */
const SETTINGS = {
  menus: ["chrome"],
  logo: ["chrome"],
  identity: ["home", "chrome"],
  design: ["design"],
} as const satisfies Record<string, SharedPart[]>;

/** A setting is recorded as the subject "setting:<name>", so its events are ordered apart. */
const SETTING = "setting:";

/** A shared setting was changed. */
const settingsEvent = z
  .object({
    ...envelope,
    action: z.literal("settings"),
    setting: z.enum(Object.keys(SETTINGS) as [keyof typeof SETTINGS]),
  })
  .strict();

type SettingsEvent = z.infer<typeof settingsEvent>;

/** What processing an event may need from the request: the Site's public origin. */
export interface EventContext {
  siteOrigin?: string;
}

/**
 * An action's handler: its event's shape, and what processing one does. A
 * parsed event is ready to run against the store, or invalid.
 */
type Handler = (event: unknown) => { invalid: string } | { occurredAt: number; run: Run };
type Run = (store: PublicationStore, context: EventContext) => Promise<EventAnswer>;

function handler<E extends { occurredAt: number }>(
  schema: z.ZodType<E>,
  handle: (store: PublicationStore, event: E, context: EventContext) => Promise<EventAnswer>,
): Handler {
  return (input) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      return { invalid: `${issue.path.join(".") || "event"} ${issue.message}` };
    }
    return {
      occurredAt: parsed.data.occurredAt,
      run: (store, context) => handle(store, parsed.data, context),
    };
  };
}

const handlers: Record<string, Handler> = {
  check: handler(checkEvent, async () => ({
    status: 200,
    body: { status: "checked", site: SITE },
  })),
  publish: handler(publishEvent, handlePublish),
  settings: handler(settingsEvent, handleSettings),
};

/** The event key when the Worker has one bound, and it is strong enough. */
async function eventAuthority(): Promise<
  { store: PublicationStore; secret: string } | { refused: string }
> {
  const { PUBLICATION_DB, PUBLICATION_EVENT_SECRET: secret } = await frontendBindings();
  if (!PUBLICATION_DB) return { refused: "this Frontend has no publication store bound" };
  if (!secret || secret.length < 32) {
    return { refused: "this Frontend has no event secret of 32 characters or more bound" };
  }
  return { store: publicationStore(PUBLICATION_DB), secret };
}

/**
 * Checks `GQ-Event-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`
 * and `GQ-Event-Timestamp` (seconds), signed within the tolerance of now.
 * Resolves to the signing time in ms, or null.
 */
async function verifiedSignature(
  request: Request,
  body: string,
  secret: string,
): Promise<number | null> {
  const timestamp = request.headers.get("GQ-Event-Timestamp") ?? "";
  const signature = /^v1=([0-9a-f]{64})$/.exec(
    request.headers.get("GQ-Event-Signature") ?? "",
  )?.[1];
  if (!/^\d{1,12}$/.test(timestamp) || !signature) return null;
  const signedAt = Number(timestamp) * 1000;
  if (Math.abs(Date.now() - signedAt) > SIGNATURE_TOLERANCE_MS) return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = new Uint8Array(signature.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    encoder.encode(`${timestamp}.${body}`),
  );
  return valid ? signedAt : null;
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  const body = await request.text();
  return new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES ? null : body;
}

/**
 * Answers one event delivery. Nothing is read from the CMS or written to the
 * store unless the event is signed with this Site's key, names this Site, has
 * a supported action and is well formed.
 */
export async function receiveEvent(
  request: Request,
  context: EventContext = {},
): Promise<EventAnswer> {
  const authority = await eventAuthority();
  if ("refused" in authority) {
    return { status: 403, body: { error: `Events are disabled: ${authority.refused}.` } };
  }
  const body = await readBody(request);
  if (body === null) return { status: 413, body: { error: "The event is too large." } };
  const signedAt = await verifiedSignature(request, body, authority.secret);
  if (signedAt === null) {
    return {
      status: 401,
      body: { error: "An event needs a current signature with this Site's event secret." },
    };
  }

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: "The event isn't JSON." } };
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { status: 400, body: { error: "The event must be a JSON object." } };
  }
  const { site, action } = event as Record<string, unknown>;
  if (site !== SITE) {
    return { status: 403, body: { error: "The event is for another Site." } };
  }
  const parse =
    typeof action === "string" && Object.hasOwn(handlers, action) ? handlers[action] : undefined;
  if (!parse) {
    return {
      status: 422,
      body: { error: `Unsupported action: ${JSON.stringify(action ?? null)}.` },
    };
  }
  const parsed = parse(event);
  if ("invalid" in parsed) {
    return { status: 400, body: { error: `Invalid event: ${parsed.invalid}.` } };
  }
  if (parsed.occurredAt > signedAt + 1000) {
    return { status: 400, body: { error: "Invalid event: it happened after it was signed." } };
  }

  try {
    return await parsed.run(authority.store, context);
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
    console.error(`Events: an event couldn't be recorded (store): ${error.message}`);
    return {
      status: 503,
      body: { error: "The publication store is unavailable; deliver the event again later." },
    };
  }
}

/**
 * A publication: the entry's route, and the one it left if it moved, are
 * refreshed (the front page's, `/`, refreshes the front page). Refreshed, the
 * event supersedes the entry's older ones; failed, it is kept on record and
 * the stored versions stay served.
 */
async function handlePublish(store: PublicationStore, event: PublishEvent): Promise<EventAnswer> {
  const publication: PublicationEvent = {
    id: event.id,
    action: event.action,
    nodeId: event.entry.id,
    uri: event.entry.uri,
    previousUri: event.entry.previousUri ?? null,
    occurredAt: event.occurredAt,
  };
  const { recorded, duplicate } = await store.receiveEvent(publication);
  if (duplicate && (recorded.status === "refreshed" || recorded.status === "superseded")) {
    console.info(`Events: ${event.id} is a duplicate of a ${recorded.status} event`);
    return { status: 200, body: { event: event.id, status: recorded.status, duplicate: true } };
  }
  const newer = await store.newerRefreshedEvent(recorded);
  if (newer) {
    await store.finishEvent(recorded, { status: "superseded" });
    console.info(`Events: ${event.id} is superseded by the newer ${newer}`);
    return { status: 200, body: { event: event.id, status: "superseded", by: newer } };
  }

  await store.startEvent(event.id);
  const routes = [
    ...new Set([recorded.uri, recorded.previousUri].filter((uri) => uri !== null).map(routeOf)),
  ];
  let home: RecordOutcome | undefined;
  if (routes.includes("/")) home = await refreshHome(store);
  const {
    refreshed: entriesRefreshed,
    entries,
    moved,
  } = await refreshEntries(
    store,
    routes.filter((route) => route !== "/"),
  );
  const failures = [home, ...Object.values(entries)].flatMap((outcome) =>
    outcome?.outcome === "kept" ? [outcome.failure] : [],
  );
  const refreshed = entriesRefreshed && failures.length === 0;
  await store.finishEvent(
    recorded,
    refreshed
      ? { status: "refreshed" }
      : {
          status: "failed",
          reason: failures[0]?.reason ?? "store",
          message: failures[0]?.message ?? "the routes the entry left couldn't be reconciled",
        },
  );
  console.info(
    `Events: ${event.id} (publish ${recorded.uri}) ${refreshed ? "refreshed" : "failed"}`,
  );
  return {
    status: refreshed ? 200 : 503,
    body: {
      event: event.id,
      status: refreshed ? "refreshed" : "failed",
      ...(home ? { home } : {}),
      entries,
      moved,
    },
  };
}

/**
 * A shared setting's change: the rows every affected page is served with are
 * refreshed (refreshShared), so the change reaches every page without reading
 * or republishing each entry. A setting's events are ordered like an entry's:
 * a duplicate isn't processed again, and an event older than one refreshed for
 * the same setting is superseded. Failed, it is kept on record for a retry and
 * the stored chrome, design and front page stay served.
 */
async function handleSettings(
  store: PublicationStore,
  event: SettingsEvent,
  { siteOrigin }: EventContext,
): Promise<EventAnswer> {
  const { recorded, duplicate } = await store.receiveEvent({
    id: event.id,
    action: event.action,
    nodeId: `${SETTING}${event.setting}`,
    // Every route: a shared setting is on every page.
    uri: "/",
    previousUri: null,
    occurredAt: event.occurredAt,
  });
  if (duplicate && (recorded.status === "refreshed" || recorded.status === "superseded")) {
    console.info(`Events: ${event.id} is a duplicate of a ${recorded.status} event`);
    return { status: 200, body: { event: event.id, status: recorded.status, duplicate: true } };
  }
  const newer = await store.newerRefreshedEvent(recorded);
  if (newer) {
    await store.finishEvent(recorded, { status: "superseded" });
    console.info(`Events: ${event.id} is superseded by the newer ${newer}`);
    return { status: 200, body: { event: event.id, status: "superseded", by: newer } };
  }

  await store.startEvent(event.id);
  const { refreshed, ...parts } = await refreshShared(
    store,
    [...SETTINGS[event.setting]],
    siteOrigin,
  );
  const failure = Object.values(parts).find((outcome) => outcome.outcome === "kept");
  await store.finishEvent(
    recorded,
    failure?.outcome === "kept"
      ? { status: "failed", reason: failure.failure.reason, message: failure.failure.message }
      : { status: "refreshed" },
  );
  console.info(
    `Events: ${event.id} (settings ${event.setting}) ${refreshed ? "refreshed" : "failed"}`,
  );
  return {
    status: refreshed ? 200 : 503,
    body: {
      event: event.id,
      status: refreshed ? "refreshed" : "failed",
      setting: event.setting,
      ...parts,
    },
  };
}
