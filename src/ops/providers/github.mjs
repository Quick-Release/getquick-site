export async function syncActionsValues({
  context,
  env,
  exec,
  dryRun = false,
  yes = false,
  interactive = false,
}) {
  const github = context.config.github;
  const repository = github?.repository;
  const environment = github?.environment || "production";
  const secrets = normalizeEntries(github?.secrets);
  const variables = normalizeEntries(github?.variables);

  if (!repository) throw new Error("gq.ops.json must define github.repository.");
  if (!secrets || !variables) {
    throw new Error("github.secrets and github.variables must be arrays.");
  }

  const values = context.env;
  const activeSecrets = configuredEntries(secrets, values);
  const activeVariables = configuredEntries(variables, values);
  const missingSecrets = missingValues(secrets, values);
  const missingVariables = missingValues(variables, values);
  if (missingSecrets.length > 0 || missingVariables.length > 0) {
    const missing = [
      ...missingSecrets.map((name) => `secret ${name}`),
      ...missingVariables.map((name) => `variable ${name}`),
    ];
    throw new Error(`Missing values in .env or the process environment: ${missing.join(", ")}`);
  }

  const plan = {
    repository,
    environment,
    secrets: activeSecrets.map(({ name }) => name),
    variables: activeVariables.map(({ name }) => name),
  };
  if (dryRun) return { ...plan, applied: false };

  if (!yes && interactive) {
    const { confirm } = await import("@clack/prompts");
    const answer = await confirm({
      message: `Sync ${secrets.length} secrets and ${variables.length} variables to ${repository}/${environment}?`,
      initialValue: false,
    });
    if (answer !== true) throw new Error("GitHub synchronization cancelled.");
  } else if (!yes && !interactive) {
    throw new Error("GitHub synchronization requires --yes outside an interactive terminal.");
  }

  for (const { name } of activeSecrets) {
    await runGh(["secret", "set", name, "--repo", repository, "--env", environment], values[name], {
      exec,
      env,
      tokens: context.env,
    });
  }
  for (const { name } of activeVariables) {
    await runGh(
      ["variable", "set", name, "--repo", repository, "--env", environment],
      values[name],
      { exec, env, tokens: context.env },
    );
  }

  return { ...plan, applied: true };
}

// The value goes to gh on stdin, never in its arguments.
async function runGh(args, input, { exec, env, tokens }) {
  const { code, stdout, stderr } = await exec("gh", args, {
    env: {
      ...env,
      ...(tokens.GITHUB_TOKEN ? { GH_TOKEN: tokens.GITHUB_TOKEN } : {}),
      ...(tokens.GH_TOKEN ? { GH_TOKEN: tokens.GH_TOKEN } : {}),
    },
    input: String(input),
  });
  if (code !== 0) {
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${(stderr || stdout).trim()}`);
  }
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return null;
  return entries.map((entry) => {
    if (typeof entry === "string") return { name: entry, required: true };
    if (entry && typeof entry.name === "string") {
      return { name: entry.name, required: entry.required !== false };
    }
    throw new Error("GitHub sync entries must be names or { name, required } objects.");
  });
}

function configuredEntries(entries, values) {
  return entries.filter(({ name }) => values[name] !== undefined && values[name] !== "");
}

function missingValues(entries, values) {
  return entries
    .filter(({ name, required }) => required && (values[name] === undefined || values[name] === ""))
    .map(({ name }) => name);
}
