import type { CiBindings } from "@cloudflare/ci/worker";

import type { MirrorParams } from "./github.ts";

// Secrets set by `pnpm ci:deploy` from Sigillo staging.
export type Bindings = CiBindings & {
  CF_TOKEN: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  PLOI_API_TOKEN: string;
  RELEASES_R2_ACCESS_KEY_ID: string;
  RELEASES_R2_SECRET_ACCESS_KEY: string;
  // GETQUICK Composer registry login: CI's composer install and the Ploi deploy.
  COMPOSER_AUTH: string;
  CLOUDFLARE_DEPLOY_ACCOUNT_ID: string;
  // GitHub (pnpm github:setup): a fine-grained token for GITHUB_REPOSITORY
  // (Contents: read, Commit statuses: read and write) and the webhook secret.
  GITHUB_CI_TOKEN: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_REPOSITORY: string;
  ARTIFACTS_NAMESPACE: string;
  ARTIFACTS_REPO: string;
  MIRROR_WORKFLOW: Workflow<MirrorParams>;
};
