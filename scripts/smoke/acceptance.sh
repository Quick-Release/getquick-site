#!/usr/bin/env bash
#
# Spec #38's local acceptance gate (ADR 0010), on disposable sites generated
# from this checkout's blueprint, without a Cloudflare account, a live CMS or
# a secret: the package's own checks, then each proof in turn.
#
#   1. pnpm check: formatting, lint, and the package's tests (generation,
#      ownership, provisioning commands and gq site check at the run() seam).
#   2. frontend-check.sh: the generated Frontend's own tests (the delivery
#      scenarios against a stubbed CMS), astro check, lint and format.
#   3. frontend-runtime.sh: Alchemy's Astro build served in workerd with a
#      local D1 store, through outages, restarts, redeploys and events.
#   4. cms-events.sh: a real WordPress (with real WPGraphQL for readiness)
#      sending signed events to that Worker, its retries, reconciliation and,
#      with the local DDEV web server image, a real cron.
#
# Each proof deletes what it created. The live half is the gq-smoke wizard
# (scripts/smoke/gq-smoke-up.sh, stages 18 to 22). Stops at the first failure.

set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"

step() { printf '\n== %s\n' "$1"; }

step "pnpm check"
pnpm check
step "Generated Frontend checks (frontend-check.sh)"
scripts/smoke/frontend-check.sh
step "Frontend runtime proof (frontend-runtime.sh)"
scripts/smoke/frontend-runtime.sh
step "Real-CMS events and readiness proof (cms-events.sh)"
scripts/smoke/cms-events.sh
printf '\nLocal acceptance gate passed. The live half: scripts/smoke/gq-smoke-up.sh (stages 18-22).\n'
