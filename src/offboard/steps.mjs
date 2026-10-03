// What offboarding a Site cuts, and what restoring it brings back, as plans:
// inspectSite() reads, once, everything the Site exposes; cutPlan() and
// restorePlan() turn that reading into ordered items, each "done" (nothing
// left to do), "todo" (with the `apply` that does it) or "manual" (something
// gq can't do, for the operator). Applying only the "todo" items is what
// makes both commands idempotent. The archive (phase 2) plans the same way
// from the same reading.
//
// The cut writes gq.ops.json `offboarded` before anything else, so the
// guards hold while it is half done, and notes in `offboarded.cut` each
// change just before making it; --restore brings back only those.

import { webhookUrl } from "../ci/github-setup.mjs";
import { retryCrontab } from "../ploi/events.mjs";
import { updateManifest } from "../manifest/manifest.mjs";
import { frontendStages, frontendWorker } from "./names.mjs";

export const SUSPEND_REASON = "offboarded";

// Throws unless the Ploi site gq.ops.json's ploi.siteId names is the Site's
// CMS: a stale or copied id would suspend or delete another client's site.
export function assertOwnPloiSite(ops, site) {
  if (site.domain !== ops.domains.admin) {
    throw new Error(
      `The Ploi site ${ops.ploi.siteId} (gq.ops.json ploi.siteId) is ${site.domain ?? "unnamed"}, not ${ops.domains.admin} (domains.admin): stopping before anything changes.`,
    );
  }
}

// Everything the Site exposes now, read through `providers`
// (withOffboardingProviders).
export async function inspectSite(providers) {
  const { ops, cloudflare, ploi, github } = providers;
  const site = await ploi.site();
  assertOwnPloiSite(ops, site);
  const crontab = retryCrontab({
    systemUser: site.system_user ?? ops.ploi.systemUser,
    domain: site.domain ?? ops.domains.admin,
  });
  const existingCrontab = (await ploi.crontabs()).find(
    (entry) => entry.user === crontab.user && entry.command === crontab.command,
  );
  const ciUrl = webhookUrl(ops.ci.worker, await cloudflare.accountSubdomain());
  const hooks = await github.hooks();
  // The production Frontend first, then its other stages.
  const { stages, unclear } = frontendStages(ops.project, await cloudflare.workers());
  const frontends = [];
  for (const worker of [frontendWorker(ops.project), ...stages.map((stage) => stage.worker)]) {
    frontends.push({
      worker,
      domains: await cloudflare.workerDomains(worker),
      subdomain: await cloudflare.workerSubdomain(worker),
    });
  }

  return {
    ops,
    cms: { site, suspended: site.status === "suspended", crontab, existingCrontab },
    frontends,
    unclearStages: unclear,
    media: {
      ...ops.media,
      attached: await cloudflare.bucketDomain(ops.media.bucket, ops.media.domain),
    },
    ci: {
      worker: ops.ci.worker,
      subdomain: await cloudflare.workerSubdomain(ops.ci.worker),
      webhookUrl: ciUrl,
      hooks,
      hook: hooks.find((hook) => hook.config?.url === ciUrl),
    },
    tokens: await cloudflare.projectTokens(),
    record: ops.offboarded,
  };
}

const done = (area, text) => ({ area, state: "done", text });
const manual = (area, text) => ({ area, state: "manual", text });
const todo = (area, text, apply) => ({ area, state: "todo", text, apply });

// A Worker's workers.dev setting, as offboarded.cut keeps it.
const workersDev = (subdomain) => ({
  enabled: Boolean(subdomain.enabled),
  previewsEnabled: Boolean(subdomain.previews_enabled),
});

// Cutting a Site's public access, in order: the record first (the guards
// hold from then on), the final backup before anything is cut, then the CMS,
// the Frontend (every stage), media and CI, and the project's tokens last,
// since the steps before them may need what they grant.
export function cutPlan(site, { configPath, now = () => new Date() }) {
  const { ops, cms, frontends, media, ci, tokens } = site;
  const backups = `r2://${ops.backups.bucket}/${ops.backups.prefix ?? "db/"}`;
  // A todo that notes `change` in offboarded.cut, then applies.
  const cut = (area, text, note, apply) =>
    todo(area, text, async (providers) => {
      await updateManifest(configPath, (manifest) => {
        note((manifest.offboarded.cut ??= {}));
      });
      await apply(providers);
    });
  return [
    site.record
      ? done("Record", `gq.ops.json has offboarded (${site.record.phase}, since ${site.record.at})`)
      : todo(
          "Record",
          "write offboarded to gq.ops.json first, so gq refuses to expose the Site from then on (commit it)",
          () =>
            updateManifest(configPath, (manifest) => {
              manifest.offboarded = { at: now().toISOString(), phase: "cut", cut: {} };
            }),
        ),
    // A suspended CMS can't change its database any more: the backup taken
    // before it was suspended is the final one.
    cms.suspended
      ? done("Backup", "the CMS is suspended, so the backup taken before is the final one")
      : cut(
          "Backup",
          `back up ${ops.ploi.database} to ${backups} before anything is cut`,
          (record) => {
            record.backup = true;
          },
          (providers) => providers.backupDatabase(),
        ),
    cms.existingCrontab
      ? cut(
          "CMS",
          `delete the retry crontab (${cms.crontab.user}: wp gq-events retry-due)`,
          (record) => {
            const { user, frequency, command } = cms.existingCrontab;
            record.crontab = { user, frequency, command };
          },
          (p) => p.ploi.deleteCrontab(cms.existingCrontab.id),
        )
      : done("CMS", "no retry crontab"),
    cms.suspended
      ? done("CMS", `the Ploi site ${ops.domains.admin} is suspended`)
      : cut(
          "CMS",
          `suspend the Ploi site ${ops.domains.admin} (reason "${SUSPEND_REASON}"); its files, .env and database stay`,
          (record) => {
            record.suspended = true;
          },
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
    ...frontends.flatMap((frontend) => [
      ...(frontend.domains.length > 0
        ? frontend.domains.map((domain) =>
            cut(
              "Frontend",
              `detach ${domain.hostname} from the Worker ${frontend.worker}`,
              (record) => {
                const detached = (record.workerDomains ??= []);
                if (!detached.some(({ hostname }) => hostname === domain.hostname)) {
                  detached.push({
                    hostname: domain.hostname,
                    service: frontend.worker,
                    zoneId: domain.zone_id,
                  });
                }
              },
              (p) => p.cloudflare.detachWorkerDomain(domain.id),
            ),
          )
        : [done("Frontend", `the Worker ${frontend.worker} has no custom domain`)]),
      frontend.subdomain.enabled || frontend.subdomain.previews_enabled
        ? cut(
            "Frontend",
            `switch the Worker ${frontend.worker}'s workers.dev and preview URLs off (the Worker and its D1 store stay)`,
            (record) => {
              (record.workersDev ??= {})[frontend.worker] ??= workersDev(frontend.subdomain);
            },
            (p) =>
              p.cloudflare.setWorkerSubdomain(frontend.worker, {
                enabled: false,
                previewsEnabled: false,
              }),
          )
        : done("Frontend", `the Worker ${frontend.worker}'s workers.dev and preview URLs are off`),
    ]),
    ...site.unclearStages.map((worker) =>
      manual(
        "Frontend",
        `the Worker ${worker} is named like one of ${ops.project}'s Frontend stages, but not as ${frontendWorker(ops.project)}-<stage>; check it by hand`,
      ),
    ),
    media.attached?.enabled
      ? cut(
          "Media",
          `disable https://${media.domain} on the bucket ${media.bucket} (the bucket and its objects stay)`,
          (record) => {
            record.mediaDomain = media.domain;
          },
          (p) => p.cloudflare.setBucketDomain(media.bucket, media.domain, false),
        )
      : done("Media", `https://${media.domain} is ${media.attached ? "disabled" : "not attached"}`),
    ci.hook?.active
      ? cut(
          "CI",
          `deactivate the GitHub push webhook ${ci.hook.id} on ${ops.github.repository}`,
          (record) => {
            record.webhook = ci.hook.id;
          },
          (p) => p.github.updateHook(ci.hook.id, { active: false }),
        )
      : done("CI", `no active GitHub push webhook to ${ci.webhookUrl}`),
    ci.subdomain.enabled || ci.subdomain.previews_enabled
      ? cut(
          "CI",
          `switch the CI Worker ${ci.worker}'s workers.dev off`,
          (record) => {
            (record.workersDev ??= {})[ci.worker] ??= workersDev(ci.subdomain);
          },
          (p) =>
            p.cloudflare.setWorkerSubdomain(ci.worker, { enabled: false, previewsEnabled: false }),
        )
      : done("CI", `the CI Worker ${ci.worker}'s workers.dev is off`),
    ...tokens.map((token) =>
      token.status === "active"
        ? cut(
            "Tokens",
            `disable ${token.name}`,
            (record) => {
              const disabled = (record.tokens ??= []);
              if (!disabled.includes(token.id)) disabled.push(token.id);
            },
            (p) => p.cloudflare.setTokenStatus(token, "disabled"),
          )
        : done("Tokens", `${token.name} is ${token.status}`),
    ),
  ];
}

// Bringing a cut Site back, in the reverse order, and only what the cut
// changed (gq.ops.json offboarded.cut): its tokens first, then CI, media,
// the Frontend's domains and workers.dev as they were, and the CMS; then
// gq.ops.json loses `offboarded`. Tokens are re-enabled, never recreated.
export function restorePlan(site, { configPath }) {
  const { ops, cms, frontends, media, ci, tokens } = site;
  const cut = site.record?.cut ?? {};
  const disabled = new Set(cut.tokens ?? []);
  const restoredWorkersDev = (area, worker, setting, subdomain) =>
    !subdomain
      ? manual(area, `the Worker ${worker} is gone; its workers.dev can't come back`)
      : subdomain.enabled === setting.enabled &&
          Boolean(subdomain.previews_enabled) === setting.previewsEnabled
        ? done(area, `the Worker ${worker}'s workers.dev and preview URLs are as before`)
        : todo(
            area,
            `switch the Worker ${worker}'s workers.dev ${setting.enabled ? "on" : "off"} and its preview URLs ${setting.previewsEnabled ? "on" : "off"}, as before`,
            (p) => p.cloudflare.setWorkerSubdomain(worker, setting),
          );
  const hook = ci.hooks.find(({ id }) => id === cut.webhook);
  return [
    ...(site.record && !site.record.cut
      ? [
          manual(
            "Record",
            "gq.ops.json offboarded records nothing the cut changed: restore by hand",
          ),
        ]
      : []),
    ...tokens.flatMap((token) => {
      if (!disabled.has(token.id)) {
        return token.status === "active"
          ? []
          : [
              manual(
                "Tokens",
                `${token.name} stays ${token.status}: gq offboard didn't disable it`,
              ),
            ];
      }
      return token.status === "active"
        ? [done("Tokens", `${token.name} is active`)]
        : [
            todo("Tokens", `re-enable ${token.name}`, (p) =>
              p.cloudflare.setTokenStatus(token, "active"),
            ),
          ];
    }),
    ...[...disabled]
      .filter((id) => !tokens.some((token) => token.id === id))
      .map((id) =>
        manual(
          "Tokens",
          `the token ${id} the cut disabled is gone: the gq command that made it makes it again`,
        ),
      ),
    ...(cut.workersDev?.[ci.worker]
      ? [restoredWorkersDev("CI", ci.worker, cut.workersDev[ci.worker], ci.subdomain)]
      : []),
    ...(cut.webhook === undefined
      ? []
      : !hook
        ? [manual("CI", `the GitHub push webhook ${cut.webhook} is gone: run pnpm github:setup`)]
        : hook.active
          ? [done("CI", `the GitHub push webhook ${hook.id} is active`)]
          : [
              todo(
                "CI",
                `reactivate the GitHub push webhook ${hook.id} on ${ops.github.repository}`,
                (p) => p.github.updateHook(hook.id, { active: true }),
              ),
            ]),
    ...(!cut.mediaDomain
      ? []
      : !media.attached
        ? [manual("Media", `https://${media.domain} isn't attached: run pnpm cf:media`)]
        : media.attached.enabled
          ? [done("Media", `https://${media.domain} is enabled`)]
          : [
              todo(
                "Media",
                `re-enable https://${media.domain} on the bucket ${media.bucket}`,
                (p) => p.cloudflare.setBucketDomain(media.bucket, media.domain, true),
              ),
            ]),
    ...(cut.workerDomains ?? []).map(({ hostname, service, zoneId }) =>
      frontends
        .find(({ worker }) => worker === service)
        ?.domains.some((domain) => domain.hostname === hostname)
        ? done("Frontend", `${hostname} is attached to the Worker ${service}`)
        : todo("Frontend", `attach ${hostname} to the Worker ${service}`, (p) =>
            p.cloudflare.attachWorkerDomain({ hostname, service, zoneId }),
          ),
    ),
    ...Object.entries(cut.workersDev ?? {})
      .filter(([worker]) => worker !== ci.worker)
      .map(([worker, setting]) =>
        restoredWorkersDev(
          "Frontend",
          worker,
          setting,
          frontends.find((frontend) => frontend.worker === worker)?.subdomain,
        ),
      ),
    ...(cut.suspended
      ? [
          cms.suspended
            ? todo("CMS", `resume the Ploi site ${ops.domains.admin}`, (p) => p.ploi.resume())
            : done("CMS", `the Ploi site ${ops.domains.admin} is active`),
        ]
      : []),
    ...(cut.crontab
      ? [
          cms.existingCrontab
            ? done("CMS", "the retry crontab is there")
            : todo(
                "CMS",
                `re-add the retry crontab (${cut.crontab.user}: wp gq-events retry-due)`,
                (p) => p.ploi.createCrontab(cut.crontab),
              ),
        ]
      : []),
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
