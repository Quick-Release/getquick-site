// What offboarding a Site cuts, and what restoring it brings back, as plans:
// inspectSite() reads, once, everything the Site exposes; cutPlan() and
// restorePlan() turn that reading into ordered items, each "done" (nothing
// left to do), "todo" (with the `apply` that does it) or "manual" (something
// gq can't do, for the operator). Applying only the "todo" items is what
// makes both commands idempotent. The archive (phase 2) plans the same way
// from the same reading.

import { webhookUrl } from "../ci/github-setup.mjs";
import { retryCrontab } from "../ploi/events.mjs";
import { updateManifest } from "../manifest/manifest.mjs";
import { frontendWorker } from "./providers.mjs";

export const SUSPEND_REASON = "offboarded";

// What frontend.run.ts gives the production Worker: no workers.dev URL, and
// preview URLs on.
const FRONTEND_SUBDOMAIN = { enabled: false, previewsEnabled: true };

// Everything the Site exposes now, read through `providers`
// (withOffboardingProviders).
export async function inspectSite(providers) {
  const { ops, cloudflare, ploi, github } = providers;
  const site = await ploi.site();
  const crontab = retryCrontab({
    systemUser: site.system_user ?? ops.ploi.systemUser,
    domain: site.domain ?? ops.domains.admin,
  });
  const existingCrontab = (await ploi.crontabs()).find(
    (entry) => entry.user === crontab.user && entry.command === crontab.command,
  );
  const frontend = frontendWorker(ops.project);
  const ciUrl = webhookUrl(ops.ci.worker, await cloudflare.accountSubdomain());
  const hooks = await github.hooks();

  return {
    ops,
    cms: { site, suspended: site.status === "suspended", crontab, existingCrontab },
    frontend: {
      worker: frontend,
      domains: await cloudflare.workerDomains(frontend),
      subdomain: await cloudflare.workerSubdomain(frontend),
    },
    media: {
      ...ops.media,
      attached: await cloudflare.bucketDomain(ops.media.bucket, ops.media.domain),
    },
    ci: {
      worker: ops.ci.worker,
      subdomain: await cloudflare.workerSubdomain(ops.ci.worker),
      webhookUrl: ciUrl,
      hook: hooks.find((hook) => hook.config?.url === ciUrl),
    },
    tokens: await cloudflare.projectTokens(),
    record: ops.offboarded,
  };
}

const done = (area, text) => ({ area, state: "done", text });
const manual = (area, text) => ({ area, state: "manual", text });
const todo = (area, text, apply) => ({ area, state: "todo", text, apply });

// Cutting a Site's public access, in order: the final backup before anything
// is cut, then the CMS, the Frontend, media and CI, and the project's tokens
// last, since the steps before them may need what they grant. `record` writes
// gq.ops.json `offboarded`.
export function cutPlan(site, { configPath, now = () => new Date() }) {
  const { ops, cms, frontend, media, ci, tokens } = site;
  const backups = `r2://${ops.backups.bucket}/${ops.backups.prefix ?? "db/"}`;
  return [
    // A suspended CMS can't change its database any more: the backup taken
    // before it was suspended is the final one.
    cms.suspended
      ? done("Backup", "the CMS is suspended, so the backup taken before is the final one")
      : todo(
          "Backup",
          `back up ${ops.ploi.database} to ${backups} before anything is cut`,
          (providers) => providers.backupDatabase(),
        ),
    cms.existingCrontab
      ? todo("CMS", `delete the retry crontab (${cms.crontab.user}: wp gq-events retry-due)`, (p) =>
          p.ploi.deleteCrontab(cms.existingCrontab.id),
        )
      : done("CMS", "no retry crontab"),
    cms.suspended
      ? done("CMS", `the Ploi site ${ops.domains.admin} is suspended`)
      : todo(
          "CMS",
          `suspend the Ploi site ${ops.domains.admin} (reason "${SUSPEND_REASON}"); its files, .env and database stay`,
          (p) => p.ploi.suspend(SUSPEND_REASON),
        ),
    manual(
      "CMS",
      "Ploi's API can't disable the site's deploy webhook; the suspension is what stops it",
    ),
    manual(
      "CMS",
      `the DNS record for ${ops.domains.admin} was added by hand; remove it by hand if it should go`,
    ),
    ...(frontend.domains.length > 0
      ? frontend.domains.map((domain) =>
          todo("Frontend", `detach ${domain.hostname} from the Worker ${frontend.worker}`, (p) =>
            p.cloudflare.detachWorkerDomain(domain.id),
          ),
        )
      : [done("Frontend", `the Worker ${frontend.worker} has no custom domain`)]),
    frontend.subdomain.enabled || frontend.subdomain.previews_enabled
      ? todo(
          "Frontend",
          `switch the Worker ${frontend.worker}'s workers.dev and preview URLs off (the Worker and its D1 store stay)`,
          (p) =>
            p.cloudflare.setWorkerSubdomain(frontend.worker, {
              enabled: false,
              previewsEnabled: false,
            }),
        )
      : done("Frontend", `the Worker ${frontend.worker}'s workers.dev and preview URLs are off`),
    media.attached?.enabled
      ? todo(
          "Media",
          `disable https://${media.domain} on the bucket ${media.bucket} (the bucket and its objects stay)`,
          (p) => p.cloudflare.setBucketDomain(media.bucket, media.domain, false),
        )
      : done("Media", `https://${media.domain} is ${media.attached ? "disabled" : "not attached"}`),
    ci.hook?.active
      ? todo(
          "CI",
          `deactivate the GitHub push webhook ${ci.hook.id} on ${ops.github.repository}`,
          (p) => p.github.updateHook(ci.hook.id, { active: false }),
        )
      : done("CI", `no active GitHub push webhook to ${ci.webhookUrl}`),
    ci.subdomain.enabled || ci.subdomain.previews_enabled
      ? todo("CI", `switch the CI Worker ${ci.worker}'s workers.dev off`, (p) =>
          p.cloudflare.setWorkerSubdomain(ci.worker, { enabled: false, previewsEnabled: false }),
        )
      : done("CI", `the CI Worker ${ci.worker}'s workers.dev is off`),
    ...tokens.map((token) =>
      token.status === "active"
        ? todo("Tokens", `disable ${token.name}`, (p) =>
            p.cloudflare.setTokenStatus(token, "disabled"),
          )
        : done("Tokens", `${token.name} is ${token.status}`),
    ),
    site.record
      ? done("Record", `gq.ops.json has offboarded (${site.record.phase}, since ${site.record.at})`)
      : todo("Record", "write offboarded to gq.ops.json (commit it)", () =>
          updateManifest(configPath, (manifest) => {
            manifest.offboarded = { at: now().toISOString(), phase: "cut" };
          }),
        ),
  ];
}

// Bringing a cut Site back, in the reverse order: its tokens first, then CI,
// media, the Frontend as frontend.run.ts configures it, and the CMS; then
// gq.ops.json loses `offboarded`. Tokens are re-enabled, never recreated.
export function restorePlan(site, { configPath }) {
  const { ops, cms, frontend, media, ci, tokens } = site;
  const attached = frontend.domains.some((domain) => domain.hostname === ops.domains.frontend);
  return [
    ...tokens.map((token) =>
      token.status === "active"
        ? done("Tokens", `${token.name} is active`)
        : todo("Tokens", `re-enable ${token.name}`, (p) =>
            p.cloudflare.setTokenStatus(token, "active"),
          ),
    ),
    ci.subdomain.enabled
      ? done("CI", `the CI Worker ${ci.worker}'s workers.dev is on`)
      : todo("CI", `switch the CI Worker ${ci.worker}'s workers.dev back on`, (p) =>
          p.cloudflare.setWorkerSubdomain(ci.worker, { enabled: true }),
        ),
    !ci.hook
      ? manual("CI", `no GitHub push webhook to ${ci.webhookUrl}: run pnpm github:setup`)
      : ci.hook.active
        ? done("CI", `the GitHub push webhook ${ci.hook.id} is active`)
        : todo(
            "CI",
            `reactivate the GitHub push webhook ${ci.hook.id} on ${ops.github.repository}`,
            (p) => p.github.updateHook(ci.hook.id, { active: true }),
          ),
    !media.attached
      ? manual("Media", `https://${media.domain} isn't attached: run pnpm cf:media`)
      : media.attached.enabled
        ? done("Media", `https://${media.domain} is enabled`)
        : todo("Media", `re-enable https://${media.domain} on the bucket ${media.bucket}`, (p) =>
            p.cloudflare.setBucketDomain(media.bucket, media.domain, true),
          ),
    attached
      ? done("Frontend", `${ops.domains.frontend} is attached to the Worker ${frontend.worker}`)
      : todo("Frontend", `attach ${ops.domains.frontend} to the Worker ${frontend.worker}`, (p) =>
          p.cloudflare.attachWorkerDomain({
            hostname: ops.domains.frontend,
            service: frontend.worker,
            zoneId: ops.cloudflare.zoneId,
          }),
        ),
    frontend.subdomain.enabled === FRONTEND_SUBDOMAIN.enabled &&
    frontend.subdomain.previews_enabled === FRONTEND_SUBDOMAIN.previewsEnabled
      ? done("Frontend", `the Worker ${frontend.worker}'s preview URLs are on, workers.dev off`)
      : todo(
          "Frontend",
          `switch the Worker ${frontend.worker}'s preview URLs back on (workers.dev stays off)`,
          (p) => p.cloudflare.setWorkerSubdomain(frontend.worker, FRONTEND_SUBDOMAIN),
        ),
    cms.suspended
      ? todo("CMS", `resume the Ploi site ${ops.domains.admin}`, (p) => p.ploi.resume())
      : done("CMS", `the Ploi site ${ops.domains.admin} is active`),
    cms.existingCrontab
      ? done("CMS", "the retry crontab is there")
      : todo("CMS", `re-add the retry crontab (${cms.crontab.user}: wp gq-events retry-due)`, (p) =>
          p.ploi.createCrontab(cms.crontab),
        ),
    manual("CMS", `if you removed the DNS record for ${ops.domains.admin}, add it back by hand`),
    site.record
      ? todo("Record", "remove offboarded from gq.ops.json (commit it)", () =>
          updateManifest(configPath, (manifest) => {
            delete manifest.offboarded;
          }),
        )
      : done("Record", "gq.ops.json has no offboarded"),
  ];
}
