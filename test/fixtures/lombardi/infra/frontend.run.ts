import * as Alchemy from "alchemy";
import { Stack } from "alchemy/Stack";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { readFileSync } from "node:fs";

// Hostnames live in gq.ops.json (domains), shared with the Ploi and deploy scripts.
const ops = JSON.parse(readFileSync(new URL("../gq.ops.json", import.meta.url), "utf8")) as {
  domains: { frontend: string };
};
const productionHostname = ops.domains.frontend;

export const Website = Cloudflare.Website.Astro(
  "LombardiFrontend",
  Stack.useSync(({ stage }) => {
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
