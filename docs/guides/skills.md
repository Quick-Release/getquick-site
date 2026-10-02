# Agent skills

[Documentation](../README.md)

`gq skills update` keeps registered upstream agent skills in sync. It works
from any directory inside a Git repository and does not need `gq.ops.json`, so
it can be used in repositories that are not generated GETQUICK sites.

## Register skills

Registrations live in `.agents/skills.json`:

```json
{
  "schemaVersion": 1,
  "skills": {
    "code-review": {
      "repository": "mattpocock/skills",
      "path": "skills/engineering/code-review",
      "ref": "main",
      "trackingBranch": "main"
    }
  }
}
```

Each key names the directory under `.agents/skills`. `repository` is
`owner/repo`, `path` is the upstream directory to copy, `ref` is the Git ref to
resolve, and `trackingBranch` records the branch Renovate or a human should
watch.

Unregistered skills, and any other project-owned files under `.agents/skills`,
are left untouched and are never used to infer sources.

## Update and check

```sh
gq skills update
gq skills update --check
```

`skills-lock.json` records the installed commit and the hash and mode of every
managed file, including supporting files such as `agents/*.yaml`, templates,
notes or scripts. Commit `.agents/skills.json`, `skills-lock.json` and the
managed skill files together.

`--check` is read-only: it reports pending updates and exits `1` when any are
available, else `0`.

For multi-skill updates, provide `GITHUB_TOKEN` or `GH_TOKEN`. GitHub's
unauthenticated limit is easy to hit when many skills and supporting files are
fetched.

## Local drift and bootstrapping

A managed skill with local drift is refused: changed, missing or extra managed
files must be reverted to the locked state before `gq skills update` will
replace them.

When a registered skill already exists locally but `skills-lock.json` is
missing, `gq skills update` bootstraps it only if the local directory exactly
matches the fetched upstream bytes and modes. Otherwise it refuses to overwrite
that local copy.

## Safety model

Write updates take a cooperative repository lock (`.gq-skills-update.lock`), so
concurrent `gq skills update` writers are serialized. This lock is advisory: it
does not protect against uncooperative or malicious concurrent filesystem
replacement, and a crash such as `SIGKILL` in the middle of a multi-directory
swap is not a crash-atomic commit guarantee.

Safety checks reject symlink anchors (`.agents`, `.agents/skills`,
`.agents/skills.json`, `skills-lock.json`) and unsafe registration paths
(backslashes, absolute paths, `.`, `..` or NULs). Skill keys `__proto__`,
`constructor` and `.backup` are reserved.
