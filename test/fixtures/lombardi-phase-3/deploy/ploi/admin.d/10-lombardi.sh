#!/usr/bin/env bash
# Lombardi's own deploy steps, moved out of its deploy script when the
# blueprint generates it. Runs from $APP_PATH after the plugins are active.
set -euo pipefail

# Left over from the site's former git-based deploys.
rm -rf "$SITE_PATH/.git"
# The GETQUICK plugins used to ship here; Composer installs them now.
rm -rf "$SITE_PATH/packages/wordpress"
rmdir "$SITE_PATH/packages" 2>/dev/null || true

# lombardi-theme is a child of getquick-theme, which must stay installed.
if ! wp theme is-installed lombardi-theme; then
  echo "Expected theme lombardi-theme to be installed by Composer in $APP_PATH." >&2
  exit 1
fi
wp theme activate lombardi-theme
# Releases before the design plugin got its own slug installed it as
# getquick-options. Composer now installs it as getquick-design, so forget
# the old slug (whether or not Composer already removed its directory).
wp eval 'deactivate_plugins("getquick-options/getquick-design.php", true);'
rm -rf web/app/plugins/getquick-options
# The post types plugin was getquick-post-types until it became
# lombardi-post-types (it also registers the project taxonomies now).
wp eval 'deactivate_plugins("getquick-post-types/getquick-post-types.php", true);'
rm -rf web/app/plugins/getquick-post-types
# Contact settings are built into GETQUICK Config; retire the old site plugin.
if wp plugin is-active lombardi-contact >/dev/null 2>&1; then
  wp plugin deactivate lombardi-contact --quiet
fi
rm -rf web/app/plugins/lombardi-contact
