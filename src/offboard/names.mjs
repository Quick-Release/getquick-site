// How gq names a Site's own Cloudflare resources (infra/frontend.run.ts,
// gq cloudflare ci, gq.ops.json), which offboarding finds them by and never
// reaches past: the zone, the Ploi server and the account are shared.

// The production Frontend Worker.
export function frontendWorker(project) {
  return `${project}-fe`;
}

// The D1 publication store of the production Frontend, or of `stage`'s.
export function publicationsStore(project, stage) {
  return stage ? `${project}-fe-publications-${stage}` : `${project}-fe-publications`;
}

// A non-production stage's name: one word, so `<project>-fe-<stage>` can't
// be another project's Worker (`<project>-fe-shop-fe` is project
// `<project>-fe-shop`'s).
const STAGE = /^[a-z0-9_]+$/u;

// Among the account's `workers`, the Frontend's non-production stages
// ([{ stage, worker }]), and the names that start like one but aren't
// (`unclear`, for the operator to check).
export function frontendStages(project, workers) {
  const prefix = `${frontendWorker(project)}-`;
  const stages = [];
  const unclear = [];
  for (const worker of workers) {
    if (!worker.startsWith(prefix)) continue;
    const stage = worker.slice(prefix.length);
    if (STAGE.test(stage)) stages.push({ stage, worker });
    else unclear.push(worker);
  }
  return { stages, unclear };
}

// Among the D1 `stores`, the non-production stages' publication stores
// ([{ stage, d1 }]).
export function publicationsStages(project, stores) {
  const prefix = `${publicationsStore(project)}-`;
  return stores
    .filter(({ name }) => name.startsWith(prefix) && STAGE.test(name.slice(prefix.length)))
    .map((d1) => ({ stage: d1.name.slice(prefix.length), d1 }));
}

// Whether `name` (a Worker, Workflow, container, bucket or repository) is
// named as the project's own: the project's name, or it and a hyphen first,
// as gq names what it provisions. The archive deletes nothing else, whatever
// gq.ops.json says.
export function isOwn(project, name) {
  return name === project || name.startsWith(`${project}-`);
}
