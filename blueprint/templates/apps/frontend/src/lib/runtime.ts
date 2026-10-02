import type { SqlDatabase } from "./publications";

/** The Worker bindings the Frontend uses (infra/frontend.run.ts declares them). */
export interface FrontendBindings {
  /** The publication store (D1). */
  PUBLICATION_DB?: SqlDatabase;
  /** The trusted refresh's bearer token (a Worker secret). */
  FRONTEND_REFRESH_TOKEN?: string;
}

/**
 * The deployed Worker's bindings. `astro dev` and tests run outside workerd,
 * where `cloudflare:workers` doesn't exist: there are none.
 */
export async function frontendBindings(): Promise<FrontendBindings> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as FrontendBindings;
  } catch {
    return {};
  }
}
