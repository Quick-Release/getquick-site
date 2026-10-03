#!/usr/bin/env node
//
// The live editor-to-visitor acceptance on the gq-smoke Site (spec #38,
// ADR 0010), one step at a time, driven by scripts/smoke/gq-smoke-up.sh. A
// human does what only an operator can (suspending and resuming the CMS in
// Ploi, changing a setting in wp-admin, running WP-CLI over SSH, a redeploy);
// each step here acts as an editor through the CMS's REST API, as the
// dedicated Author user (CMS_CHECK_USER / CMS_CHECK_APP_PASSWORD), and reads
// the Frontend anonymously, as a visitor does. Run from the site root through
// gq sigillo run staging, which injects those credentials and the Site's
// event key; no value is printed. What a step needs from an earlier one is
// kept in GQ_SMOKE_ACCEPTANCE (a JSON file of public values: ids, URIs,
// markers, times).
//
//   node live-acceptance.mjs refused        invalid events and refresh are refused
//   node live-acceptance.mjs publish        an image and a post published as an editor reach visitors
//   node live-acceptance.mjs setting <tagline>   a tagline changed in wp-admin reaches every page
//   node live-acceptance.mjs lost           prints a change to make with WordPress's hooks removed
//   node live-acceptance.mjs lost-wait      it reaches visitors through reconciliation, within 5 minutes
//   node live-acceptance.mjs outage         with the CMS suspended: pages, media and 503 for the unknown
//   node live-acceptance.mjs prolonged <minutes>   the same, at least that long into the outage
//   node live-acceptance.mjs withdraw       unpublishing makes the post a 404 at once
//   node live-acceptance.mjs withdrawn      still a 404 (run with the CMS suspended)
//   node live-acceptance.mjs preserved      after a redeploy: served, withdrawn and missing as before
//   node live-acceptance.mjs cleanup        deletes the post and the image

import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ops = JSON.parse(readFileSync(join(process.cwd(), "gq.ops.json"), "utf8"));
const statePath = process.env.GQ_SMOKE_ACCEPTANCE ?? join(process.cwd(), ".gq-acceptance.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

const frontend = `https://${ops.domains.frontend}`;
const admin = `https://${ops.domains.admin}`;
const mediaHost = ops.media?.domain;
const user = process.env.CMS_CHECK_USER;
const password = process.env.CMS_CHECK_APP_PASSWORD;
const eventKey = process.env.PUBLICATION_EVENT_SECRET;

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${condition || !detail ? "" : `: ${detail}`}`);
  if (!condition) failures += 1;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function visit(path) {
  const response = await fetch(new URL(path, frontend), {
    redirect: "manual",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, html: await response.text() };
}

/** Polls `path` until `done(page)` or `seconds` pass; resolves to the page and how long it took. */
async function until(path, done, seconds) {
  const start = Date.now();
  let page;
  do {
    page = await visit(path).catch((error) => ({ status: 0, html: String(error) }));
    if (done(page)) return { page, ms: Date.now() - start, ok: true };
    await sleep(5_000);
  } while (Date.now() - start < seconds * 1000);
  return { page, ms: Date.now() - start, ok: false };
}

async function rest(method, path, body, headers = {}) {
  if (!user || !password) {
    throw new Error(
      "CMS_CHECK_USER / CMS_CHECK_APP_PASSWORD are missing: run through gq sigillo run staging.",
    );
  }
  const response = await fetch(`${admin}/wp-json/wp/v2${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${user}:${password}`)}`,
      ...(body instanceof Uint8Array ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${method} /wp/v2${path}: HTTP ${response.status} ${data?.code ?? ""}`);
  }
  return data;
}

// A 1×1 PNG, distinct per run so the bytes read back are this run's.
function image(stamp) {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    ),
    (character) => character.charCodeAt(0),
  );
  // A tEXt chunk after the header would need a CRC; a trailing comment after
  // IEND is ignored by decoders and keeps the bytes unique.
  return new Uint8Array([...png, ...new TextEncoder().encode(`gq-acceptance ${stamp}`)]);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function mediaBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  return { status: response.status, hash: sha256(new Uint8Array(await response.arrayBuffer())) };
}

async function signed(event, key) {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { "Content-Type": "application/json" };
  if (key) {
    headers["GQ-Event-Timestamp"] = timestamp;
    headers["GQ-Event-Signature"] =
      `v1=${createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex")}`;
  }
  const response = await fetch(`${frontend}/gq/events`, { method: "POST", headers, body });
  return response.status;
}

const steps = {
  async refused() {
    const event = { site: ops.project, id: randomUUID(), action: "check", occurredAt: Date.now() };
    check("an unsigned event is refused (401)", (await signed(event)) === 401);
    if (eventKey) {
      check(
        "another Site's event, signed with this Site's key, is refused (403)",
        (await signed({ ...event, site: `${ops.project}-other` }, eventKey)) === 403,
      );
      check(
        "an unsupported action is refused (422)",
        (await signed({ ...event, action: "purge" }, eventKey)) === 422,
      );
    } else {
      check("PUBLICATION_EVENT_SECRET is injected (gq sigillo run staging)", false);
    }
    const refresh = await fetch(`${frontend}/gq/refresh`, { method: "POST", body: "{}" });
    check("a refresh without the token is refused (401)", refresh.status === 401);
  },

  async publish() {
    const stamp = new Date().toISOString();
    const bytes = image(stamp);
    const media = await rest("POST", "/media", bytes, {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="gq-acceptance-${Date.now()}.png"`,
    });
    const onMediaHost = new URL(media.source_url).hostname === mediaHost;
    check(`the image is stored on https://${mediaHost}`, onMediaHost, media.source_url);
    const marker = `Published for acceptance at ${stamp}.`;
    const post = await rest("POST", "/posts", {
      title: `GQ acceptance ${stamp}`,
      status: "publish",
      content: `<p>${marker}</p><figure class="wp-block-image"><img src="${media.source_url}" alt=""></figure>`,
    });
    const uri = new URL(post.link).pathname;
    Object.assign(state, {
      postId: post.id,
      uri,
      marker,
      mediaId: media.id,
      mediaUrl: media.source_url,
      mediaHash: sha256(bytes),
    });
    save();
    const reached = await until(
      uri,
      (page) => page.status === 200 && page.html.includes(marker),
      120,
    );
    check(
      `the post reaches visitors at ${uri} without a deploy (${Math.round(reached.ms / 1000)} s)`,
      reached.ok,
      `HTTP ${reached.page.status}`,
    );
    check("with the image, on the media host", reached.page.html.includes(media.source_url));
    const served = await mediaBytes(media.source_url);
    check(
      "the media host serves the uploaded bytes",
      served.status === 200 && served.hash === state.mediaHash,
    );
  },

  async setting(tagline) {
    if (!tagline) throw new Error("Usage: live-acceptance.mjs setting <tagline>");
    const meta = `<meta name="description" content="${tagline.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;")}">`;
    const home = await until("/", (page) => page.status === 200 && page.html.includes(meta), 120);
    check(
      `the new tagline reaches the homepage through its settings event (${Math.round(home.ms / 1000)} s)`,
      home.ok,
      `HTTP ${home.page.status}`,
    );
    const post = state.uri ? await visit(state.uri) : null;
    check("and the post is still served with the shared chrome", post?.status === 200);
  },

  async lost() {
    state.lostMarker = `Changed without an event at ${new Date().toISOString()}.`;
    state.lostAt = Date.now();
    save();
    const content = `<p>${state.lostMarker}</p><figure class="wp-block-image"><img src="${state.mediaUrl}" alt=""></figure>`;
    // PHP's double-quoted string, inside the shell's single quotes: the
    // content has neither a single quote nor a dollar sign.
    console.log(
      `cd /home/${ops.ploi.systemUser}/${ops.domains.admin}/apps/cms && wp eval 'remove_all_actions("wp_after_insert_post"); wp_update_post(["ID" => ${state.postId}, "post_content" => ${JSON.stringify(content)}]);'`,
    );
  },

  async "lost-wait"() {
    const caught = await until(
      state.uri,
      (page) => page.status === 200 && page.html.includes(state.lostMarker),
      6 * 60,
    );
    const minutes = (Date.now() - state.lostAt) / 60_000;
    check(
      `a change no event was sent for reaches visitors through reconciliation, ${minutes.toFixed(1)} minutes after it was made (target: 5)`,
      caught.ok && minutes <= 5.5,
      `HTTP ${caught.page.status}`,
    );
  },

  async outage() {
    state.outageAt ??= Date.now();
    save();
    await outageChecks();
  },

  async prolonged(minutes = "15") {
    const elapsed = (Date.now() - (state.outageAt ?? Date.now())) / 60_000;
    check(
      `the CMS has been down for ${elapsed.toFixed(1)} minutes (at least ${minutes})`,
      elapsed >= Number(minutes),
    );
    await outageChecks();
    delete state.outageAt;
    save();
  },

  async withdraw() {
    await rest("POST", `/posts/${state.postId}`, { status: "draft" });
    const gone = await until(state.uri, (page) => page.status === 404, 30);
    check(
      `unpublishing makes the post a 404 at once (${Math.round(gone.ms / 1000)} s)`,
      gone.ok && !gone.page.html.includes(state.lostMarker ?? state.marker),
      `HTTP ${gone.page.status}`,
    );
  },

  async withdrawn() {
    const page = await visit(state.uri);
    check(
      "with the CMS down, the withdrawn post is still a 404",
      page.status === 404,
      `HTTP ${page.status}`,
    );
  },

  async preserved() {
    const home = await visit("/");
    check("after the redeploy the homepage is served", home.status === 200, `HTTP ${home.status}`);
    const page = await visit(state.uri);
    check("the withdrawn post is still a 404", page.status === 404, `HTTP ${page.status}`);
    const missing = await visit(`/gq-acceptance-missing-${Date.now()}/`);
    check(
      "a URI WordPress confirms empty is a 404",
      missing.status === 404,
      `HTTP ${missing.status}`,
    );
  },

  async cleanup() {
    if (state.postId)
      await rest("DELETE", `/posts/${state.postId}?force=true`).catch((error) =>
        console.log(`  ⚠ ${error.message}`),
      );
    if (state.mediaId)
      await rest("DELETE", `/media/${state.mediaId}?force=true`).catch((error) =>
        console.log(`  ⚠ ${error.message}`),
      );
    for (const key of Object.keys(state)) delete state[key];
    save();
    console.log("  ✓ the acceptance post and image are deleted");
  },
};

async function outageChecks() {
  const cms = await fetch(`${admin}/wp/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ __typename }" }),
    signal: AbortSignal.timeout(15_000),
  })
    .then(async (response) => (await response.json().catch(() => null))?.data?.__typename)
    .catch(() => null);
  check("the CMS really is down (its GraphQL doesn't answer)", cms !== "RootQuery");
  const home = await visit("/");
  check("the homepage is still served", home.status === 200, `HTTP ${home.status}`);
  const post = await visit(state.uri);
  const marker = state.lostMarker ?? state.marker;
  check(
    "the post is still served, last version",
    post.status === 200 && post.html.includes(marker),
    `HTTP ${post.status}`,
  );
  const media = await mediaBytes(state.mediaUrl);
  check(
    "its image is served from the media host, same bytes",
    media.status === 200 && media.hash === state.mediaHash,
    `HTTP ${media.status}`,
  );
  const unknown = await visit(`/gq-acceptance-unknown-${Date.now()}/`);
  check(
    "a page never stored is a 503, not a 404",
    unknown.status === 503,
    `HTTP ${unknown.status}`,
  );
}

const [step, ...args] = process.argv.slice(2);
if (!steps[step]) {
  console.error(`Usage: live-acceptance.mjs ${Object.keys(steps).join(" | ")}`);
  process.exit(2);
}
try {
  await steps[step](...args);
} catch (error) {
  console.error(`  ✗ ${error.message}`);
  failures += 1;
}
process.exit(failures === 0 ? 0 : 1);
