#!/usr/bin/env bash
#
# Generates a disposable content site from this checkout's blueprint, installs
# its Frontend's dependencies and runs the Frontend's tests (including the
# rendered-route tests in src/routes.test.ts), `astro check`, lint and format.
#
# The site installs @getquick/site from this checkout, not npm
# (this-checkout.sh). Generation stays offline and secret-free; only
# `pnpm install` uses the network, to fetch the Frontend's npm dependencies.
# Nothing is provisioned or deployed, and the site is deleted afterwards
# unless KEEP=1.

set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
source "$repo/scripts/smoke/this-checkout.sh"
parent=$(mktemp -d "${TMPDIR:-/tmp}/gq-frontend-check.XXXXXX")
if [[ "${KEEP:-}" == 1 ]]; then
  echo "Keeping the site in $parent/acme"
else
  trap 'rm -rf "$parent"' EXIT
fi

cd "$parent"
node "$repo/bin/gq.mjs" new acme --project acme --variant content >/dev/null
use_this_checkout "$repo" "$parent/acme"
cd acme
CI=1 pnpm install --filter @acme/frontend... --filter . >/dev/null

cd apps/frontend
pnpm test
pnpm check
pnpm lint
pnpm exec vp fmt --check .
