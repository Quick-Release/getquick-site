#!/usr/bin/env bash
# Activates the GETQUICK theme Composer installs. A child theme of the site's
# own replaces getquick-theme here (getquick-theme must stay installed).
set -euo pipefail

wp theme activate getquick-theme
