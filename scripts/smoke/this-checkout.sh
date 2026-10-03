# Sourced by the smoke scripts that install a generated site.
#
# use_this_checkout <repo> <site>: packs this checkout into a tarball next to
# the site and overrides @getquick/site with it in the site's
# pnpm-workspace.yaml, so `pnpm install` installs this checkout rather than
# the version npm serves. The site's package.json keeps the version it was
# generated with; a release push is tested before npm serves the release.

use_this_checkout() {
  local repo=$1 site=$2
  local packed="$site/../this-checkout"
  mkdir -p "$packed"
  (cd "$repo" && pnpm pack --pack-destination "$packed" >/dev/null)
  local tarball
  tarball=$(cd "$packed" && pwd)/$(cd "$packed" && ls getquick-site-*.tgz)
  node -e '
    const fs = require("node:fs");
    const [file, tarball] = process.argv.slice(1);
    const workspace = fs.readFileSync(file, "utf8");
    if (!/^overrides:$/m.test(workspace)) throw new Error(`${file} has no overrides`);
    const override = `overrides:\n  "@getquick/site": ${JSON.stringify(`file:${tarball}`)}`;
    fs.writeFileSync(file, workspace.replace(/^overrides:$/m, override));
  ' "$site/pnpm-workspace.yaml" "$tarball"
}
