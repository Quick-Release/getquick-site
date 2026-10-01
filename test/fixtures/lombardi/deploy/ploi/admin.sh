#!/usr/bin/env bash
set -euo pipefail

APP_PATH="apps/cms"
SITE_PATH="${PLOI_SITE_PATH:-$PWD}"
# The site has no git repository (Ploi custom deployments): `pnpm ploi:release`
# uploads a release archive to R2 and passes a short-lived URL as the deploy
# variable archive_url, which Ploi exposes as ARCHIVE_URL.
ARCHIVE_URL="${ARCHIVE_URL:-}"
# Composer installs the GETQUICK plugins from the private registry
# (proxy.composer.getquick.io); `pnpm ploi:release` passes the login as the
# deploy variable composer_auth. Never echo it.
export COMPOSER_AUTH="${COMPOSER_AUTH:-}"
SHIPPED_PATHS=("$APP_PATH" deploy/ploi)
maintenance_enabled=false
tmp_dir=""

cd "$SITE_PATH"

reload_php_fpm() {
  if ! command -v sudo >/dev/null 2>&1 || ! command -v php >/dev/null 2>&1; then
    echo "Skipping PHP-FPM reload; sudo or PHP is unavailable."
    return 0
  fi

  php_fpm_service="php$(php -r 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;')-fpm"
  if sudo -n service "$php_fpm_service" reload; then
    echo "Reloaded $php_fpm_service to clear PHP opcache."
  else
    echo "Could not reload $php_fpm_service; PHP workers may retain stale opcache." >&2
  fi
}

# Runs from $APP_PATH. Composer deletes the install directory of a package
# that left composer.lock, even when the release now ships that directory
# itself (lombardi-blocks moved from the registry into this repository), so
# every plugin and theme the release ships is copied back afterwards. This is
# also what removes files a shipped plugin or theme no longer has: the main
# rsync protects those directories.
composer_install() {
  composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
  for kind in plugins themes; do
    for shipped_dir in "$tmp_dir/release/$APP_PATH/web/app/$kind"/*/; do
      [ -d "$shipped_dir" ] || continue
      rsync -a --delete "$shipped_dir" "web/app/$kind/$(basename "$shipped_dir")/"
    done
  done
}

cleanup() {
  exit_code=$?
  trap - EXIT

  if [ "$maintenance_enabled" = true ] && [ -f "$SITE_PATH/$APP_PATH/web/wp/wp-load.php" ]; then
    (cd "$SITE_PATH/$APP_PATH" && wp maintenance-mode deactivate) || true
  fi

  if [ -n "$tmp_dir" ] && [ -d "$tmp_dir" ]; then
    rm -rf "$tmp_dir"
  fi

  deployed_sha="$(sed -n 's/^commit=//p' "$SITE_PATH/RELEASE" 2>/dev/null | head -1)"
  deployed_sha="${deployed_sha:-unknown}"
  if [ "$exit_code" -eq 0 ]; then
    echo "LOMBARDI_DEPLOY_STATUS=success SHA=$deployed_sha"
  else
    echo "LOMBARDI_DEPLOY_STATUS=failed EXIT_CODE=$exit_code SHA=$deployed_sha"
  fi

  exit "$exit_code"
}

trap cleanup EXIT

if [ -z "$ARCHIVE_URL" ]; then
  echo "ARCHIVE_URL is not set. Deploy with \`pnpm ploi:release\`, which uploads the release to R2 and passes its URL." >&2
  exit 1
fi

if [ -z "$COMPOSER_AUTH" ]; then
  echo "COMPOSER_AUTH is not set. Deploy with \`pnpm ploi:release\` (or CI), which passes the registry login." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
curl -fsSL --retry 3 -o "$tmp_dir/release.tar.gz" "$ARCHIVE_URL"
mkdir "$tmp_dir/release"
tar -xzf "$tmp_dir/release.tar.gz" -C "$tmp_dir/release"
if [ ! -f "$tmp_dir/release/RELEASE" ] || [ ! -f "$tmp_dir/release/$APP_PATH/composer.json" ]; then
  echo "The release archive has no RELEASE manifest or $APP_PATH/composer.json." >&2
  exit 1
fi
echo "Deploying $(tr '\n' ' ' < "$tmp_dir/release/RELEASE")"

# Replace the shipped code, keeping what the server owns: the .env, Composer's
# vendor/ and installed WordPress core/plugins/themes, and uploads.
for path in "${SHIPPED_PATHS[@]}"; do
  mkdir -p "$path"
  rsync -a --delete \
    --filter='P /.env' \
    --filter='P /vendor/' \
    --filter='P /web/wp/' \
    --filter='P /web/app/uploads/' \
    --filter='P /web/app/plugins/*/' \
    --filter='P /web/app/themes/*/' \
    --filter='P /web/app/mu-plugins/*/' \
    "$tmp_dir/release/$path/" "$path/"
done
cp "$tmp_dir/release/RELEASE" RELEASE
# Left over from the site's former git-based deploys.
rm -rf .git
# The GETQUICK plugins used to ship here; Composer installs them now.
rm -rf packages/wordpress
rmdir packages 2>/dev/null || true

# Ploi's environment editor manages the site-root .env; Bedrock reads it from
# the app directory.
if [ -f .env ]; then
  cp .env "$APP_PATH/.env"
fi

# Ploi can leave its placeholder in the site root. Remove it so the configured
# Bedrock docroot serves apps/cms/web/index.php.
if [ -f index.html ]; then
  rm -f index.html
fi

# If an existing Ploi site still uses the default /public web directory, point
# that directory at the Bedrock web root so Nginx can reach WordPress.
if [ -L public ]; then
  current_public_target="$(readlink public)"
  if [ "$current_public_target" != "$APP_PATH/web" ]; then
    rm -f public
    ln -s "$APP_PATH/web" public
  fi
elif [ ! -e public ]; then
  ln -s "$APP_PATH/web" public
elif [ -d public ] && [ -f public/index.html ] && [ "$(find public -mindepth 1 -maxdepth 1 | wc -l)" -eq 1 ]; then
  rm -rf public
  ln -s "$APP_PATH/web" public
elif [ -d public ]; then
  echo "Leaving existing public/ directory in place. Set Ploi's web directory to $APP_PATH/web or replace public/ with a symlink to $APP_PATH/web."
else
  echo "public exists and is not a directory or symlink. Set Ploi's web directory to $APP_PATH/web."
fi

# A Composer-only deployment updates tracked WordPress/plugin files and vendor
# packages, then exits before any WP-CLI or database operation.
if [ "${COMPOSER_ONLY:-false}" = "true" ]; then
  cd "$APP_PATH"
  composer_install
  mkdir -p web/app/uploads
  reload_php_fpm
  echo "Composer dependencies deployed; skipping WordPress and database operations."
  exit 0
fi

if [ -f "$APP_PATH/web/wp/wp-load.php" ] && (cd "$APP_PATH" && wp core is-installed); then
  (cd "$APP_PATH" && wp maintenance-mode activate) || true
  maintenance_enabled=true
fi

cd "$APP_PATH"
composer_install

# Uploads are runtime content, not repository code. Keep the directory present
# on a fresh site and configure it as persistent storage before publishing media.
mkdir -p web/app/uploads

reload_php_fpm

if [ ! -f web/index.php ]; then
  echo "Expected Bedrock web/index.php after composer install."
  exit 1
fi

# The first deployment only installs the Bedrock files. WordPress is installed
# from /wp/wp-admin/install.php once the production database exists; every
# deploy after that activates plugins/theme and applies pending migrations.
require_installed() {
  if ! wp "$1" is-installed "$2"; then
    echo "Expected $1 $2 to be installed by Composer in $APP_PATH." >&2
    exit 1
  fi
}

if wp core is-installed; then
  # lombardi-theme is a child of getquick-theme, which must stay installed.
  require_installed theme getquick-theme
  require_installed theme lombardi-theme
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
  for plugin in getquick-design lombardi-post-types lombardi-blocks gq-support wp-graphql wpgraphql-blocks s3-uploads simple-history cimo-image-optimizer safe-svg; do
    require_installed plugin "$plugin"
    wp plugin activate "$plugin" --quiet
  done
  # getquick-config is a must-use plugin (always active, invisible to
  # `wp plugin`); check that Bedrock's autoloader actually loaded it.
  if ! wp eval 'exit(defined("GETQUICK_CONFIG_VERSION") ? 0 : 1);'; then
    echo "The getquick-config must-use plugin did not load (GETQUICK_CONFIG_VERSION is undefined)." >&2
    exit 1
  fi
  wp core update-db --quiet
  wp rewrite flush --hard --quiet

  # Media on R2: the first deploy with S3 Uploads configured copies the
  # uploads already on the server into the bucket, once.
  if wp eval 'exit(defined("S3_UPLOADS_BUCKET") && S3_Uploads\enabled() ? 0 : 1);' 2>/dev/null \
    && ! wp option get getquick_media_uploads_copied >/dev/null 2>&1; then
    echo "Copying existing uploads to the R2 media bucket…"
    wp s3-uploads upload-directory web/app/uploads uploads
    wp option add getquick_media_uploads_copied "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --autoload=no
  fi
fi

wp maintenance-mode deactivate || true
maintenance_enabled=false
