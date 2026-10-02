import * as Alchemy from "alchemy";
import { Stack } from "alchemy/Stack";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Hostnames live in gq.ops.json (domains), shared with the Ploi and deploy scripts.
const ops = JSON.parse(readFileSync(new URL("../gq.ops.json", import.meta.url), "utf8")) as {
  domains: { frontend: string };
};
const productionHostname = ops.domains.frontend;

// A Frontend that ships the publication store's migrations serves published
// content from it (durable delivery): new content sites do. A Frontend
// without them keeps reading the CMS on each request and gets no store.
const publicationMigrations = fileURLToPath(
  new URL("../apps/frontend/migrations", import.meta.url),
);
const durableDelivery = existsSync(publicationMigrations);

// The trusted refresh's credential, from Sigillo staging. Without it the
// Worker refuses every refresh; what is already stored keeps being served.
const refreshToken = process.env.FRONTEND_REFRESH_TOKEN?.trim();

// The Site's last-known-good published content. One database per Site and
// stage, separate from the Worker, so a redeploy or restart keeps it; Alchemy
// applies the Frontend's migrations, in order, before the Worker is updated.
// Production's is retained even if this declaration goes away.
const Publications = Effect.gen(function* () {
  const { stage } = yield* Stack;
  const production = stage === "prod";
  return yield* Cloudflare.D1.Database("LombardiPublications", {
    name: production ? "lombardi-fe-publications" : `lombardi-fe-publications-${stage}`,
    migrations: publicationMigrations,
  }).pipe(Alchemy.RemovalPolicy.retain(production));
});

export const Website = Cloudflare.Website.Astro(
  "LombardiFrontend",
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const production = stage === "prod";

    return {
      name: production ? "lombardi-fe" : `lombardi-fe-${stage}`,
      rootDir: "../apps/frontend",
      ...(production ? { domain: productionHostname } : {}),
      astro: {
        site: production
          ? `https://${productionHostname}`
          : `https://lombardi-fe-${stage}.workers.dev`,
        output: "server",
      },
      workersDev: production ? { enabled: false, previewsEnabled: true } : true,
      sessionKVBindingName: false,
      env: durableDelivery
        ? {
            PUBLICATION_DB: yield* Publications,
            ...(refreshToken ? { FRONTEND_REFRESH_TOKEN: Redacted.make(refreshToken) } : {}),
          }
        : {},
    };
  }),
);

export default Alchemy.Stack(
  "LombardiFrontend",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const site = yield* Website;

    return { url: site.url };
  }),
);
