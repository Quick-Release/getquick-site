// The archive's last steps (ADR 0011): gq.ops.json's archived record
// committed and pushed to the repository's default branch, and only then the
// repository archived, since an archived repository takes no push. gq pushes
// only what can't surprise the operator: from the default branch, with
// nothing else changed in the checkout, as a fast-forward, to the repository
// it archives. Otherwise the plan says to push the record by hand and run
// the archive again, which then archives the repository.

const done = (area, text) => ({ area, state: "done", text });
const manual = (area, text) => ({ area, state: "manual", text });
const todo = (area, text, apply) => ({ area, state: "todo", text, apply });

// The repository (archived, its default branch) and whether the record can
// be pushed, read through `providers` (`ops`, `github` and `git`).
export async function inspectRepository({ ops, github, git }) {
  const { archived, defaultBranch } = await github.details();
  let push;
  try {
    push = await inspectPush(ops, git, defaultBranch);
  } catch (error) {
    push = { problem: error.message };
  }
  return { name: ops.github.repository, archived, defaultBranch, push };
}

// { remote, pushed: true } once the archived record is pushed; { remote }
// when gq can push it; { problem } when it can't, saying why.
async function inspectPush(ops, git, defaultBranch) {
  const branch = await git.branch();
  if (branch !== defaultBranch) {
    return {
      problem: branch
        ? `the checkout is on ${branch}, not ${defaultBranch}`
        : `the checkout's HEAD is detached, not on ${defaultBranch}`,
    };
  }
  const remote = await git.remote(branch);
  if (!remote) return { problem: `${branch} tracks no remote` };
  const url = await git.remoteUrl(remote);
  if (!isRepository(url, ops.github.repository)) {
    return { problem: `${remote} is ${url}, not ${ops.github.repository}` };
  }
  await git.fetch(remote, branch);
  const { behind, ahead } = await git.divergence(remote, branch);
  const archived = ops.offboarded?.phase === "archived";
  if (archived && ahead === 0 && !(await git.recordChanged())) return { remote, pushed: true };
  const others = await git.otherChanges();
  if (others.length > 0) {
    const shown = others.slice(0, 3).join(", ");
    return {
      problem: `the checkout has other changes (${shown}${others.length > 3 ? ", …" : ""})`,
    };
  }
  if (behind > 0) {
    return {
      problem: `${remote}/${branch} has ${behind} commit${behind > 1 ? "s" : ""} this checkout lacks, so the push wouldn't be a fast-forward`,
    };
  }
  return { remote };
}

// Whether the git remote `url` is GitHub's `repository` (owner/name).
function isRepository(url, repository) {
  const path = /github\.com[:/](.+?)(?:\.git)?\/?$/iu.exec(url)?.[1];
  return path?.toLowerCase() === repository.toLowerCase();
}

// Whether the run that applies repositoryItems() leaves the repository
// archived.
export function archivesRepository(repository) {
  return repository.archived || !repository.push.problem;
}

// The record pushed, then the repository archived; each "done" once it is.
export function repositoryItems(repository, { project }) {
  const { name, archived, defaultBranch, push } = repository;
  const archive = archived
    ? done("GitHub", `the repository ${name} is archived`)
    : todo("GitHub", `archive the repository ${name} (it stays readable)`, (p) =>
        p.github.archive(),
      );
  if (push.pushed) {
    return [
      done("Git", `gq.ops.json's archived record is pushed to ${push.remote}/${defaultBranch}`),
      archive,
    ];
  }
  if (archived) {
    return [
      manual(
        "Git",
        `gq.ops.json's archived record isn't pushed (${push.problem ?? "it isn't committed or pushed yet"}), and ${name} is archived, so it takes no push: unarchive it (gh repo unarchive ${name}), push gq.ops.json to ${defaultBranch}, then archive it again`,
      ),
      archive,
    ];
  }
  if (push.problem) {
    return [
      manual(
        "Git",
        `commit gq.ops.json and push it to ${defaultBranch} yourself (${push.problem}), then run gq offboard --archive again to archive the repository ${name}`,
      ),
    ];
  }
  return [
    todo("Git", `commit gq.ops.json and push it to ${push.remote}/${defaultBranch}`, async (p) => {
      if (await p.git.recordChanged()) {
        await p.git.commitRecord(`chore: archive ${project} (gq offboard --archive)`);
      }
      try {
        await p.git.push(push.remote, defaultBranch);
      } catch (error) {
        throw new Error(
          `${error.message}. gq.ops.json records ${project} as archived but isn't pushed, so ${name} isn't archived: push it to ${defaultBranch}, then run gq offboard --archive again.`,
          { cause: error },
        );
      }
    }),
    archive,
  ];
}
