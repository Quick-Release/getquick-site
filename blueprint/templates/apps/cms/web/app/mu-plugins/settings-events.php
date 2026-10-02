<?php

/**
 * Plugin Name: {{Project}} Settings Events
 * Description: Tells the Frontend when a shared setting (menus, logo, site identity, design presets) changes, so every page shows it without republishing.
 * Author: {{Project}}
 * License: GPL-2.0-or-later
 */

/*
 * A change to a shared setting becomes a "settings" event, sent the way
 * publication-events.php sends a publication (its endpoint, key and signature)
 * and recorded the same way: as pending before it is sent, then refreshed or
 * failed with a reason, here in an option per setting
 * (`gq_settings_event_<setting>`). The Frontend refreshes what the setting is
 * part of from WordPress's public GraphQL, so the event carries no content.
 *
 * The settings and the changes that send them, as the GETQUICK packages store
 * them (GQ Design's Branding and Design screens, Appearance → Menus, the
 * Customizer and the Site Editor all write these):
 *
 * - menus: a menu or menu item saved or deleted, or the menu locations changed
 *   (the Frontend shows the primary location's menu);
 * - logo: the `site_logo` option (the Customizer's `custom_logo` syncs to it);
 * - identity: the `blogname`, `blogdescription` and `site_icon` options;
 * - design: the theme's global styles (`wp_global_styles`, where GQ Design
 *   saves the palette) or the active theme (its theme.json presets).
 *
 * One event per setting per request, sent at the end of it; saving never
 * waits on it or fails because of it.
 */

declare(strict_types=1);

namespace GetQuick\Site\SettingsEvents;

use WP_Post;

use function GetQuick\Site\PublicationEvents\endpoint;
use function GetQuick\Site\PublicationEvents\secret;
use function GetQuick\Site\PublicationEvents\send;

/** The Site the events are for; the Frontend refuses any other. */
const SITE = '{{project}}';

/** Each setting's last event and its delivery: an option per setting. */
const OPTION_PREFIX = 'gq_settings_event_';

/** The shared settings the Frontend refreshes. */
const SETTINGS = ['menus', 'logo', 'identity', 'design'];

/** The options that hold a setting. */
const OPTIONS = [
    'blogname' => 'identity',
    'blogdescription' => 'identity',
    'site_icon' => 'identity',
    'site_logo' => 'logo',
];

/** Whether publication-events.php, which signs and sends events, is loaded. */
function available(): bool
{
    return function_exists('GetQuick\\Site\\PublicationEvents\\send');
}

function event_for(string $setting): array
{
    return [
        'site' => SITE,
        'id' => wp_generate_uuid4(),
        'action' => 'settings',
        'occurredAt' => (int) floor(microtime(true) * 1000),
        'setting' => $setting,
    ];
}

/** Records a setting's event and its delivery state. */
function record(string $setting, array $event, array $delivery): void
{
    update_option(OPTION_PREFIX . $setting, ['event' => $event, 'delivery' => $delivery], false);
}

/** A setting's last event and its delivery, if it has one. */
function recorded(string $setting): ?array
{
    wp_cache_delete(OPTION_PREFIX . $setting, 'options');
    $recorded = get_option(OPTION_PREFIX . $setting);

    return is_array($recorded) && isset($recorded['event'], $recorded['delivery']) ? $recorded : null;
}

/** Events to send at the end of this request, by setting. */
function queue(?array $add = null): array
{
    static $queued = [];
    if ($add !== null) {
        $queued[$add['setting']] = $add;
    }

    return $queued;
}

/**
 * A shared setting changed: its event is recorded as pending and sent at the
 * end of the request. Further changes to it in the same request move its
 * time on, so one event covers them all.
 */
function changed(string $setting): void
{
    if (! available() || ! in_array($setting, SETTINGS, true)) {
        return;
    }
    // Not configured outside production (such as local development without a
    // Frontend store): nothing to record. In production it is a failure to fix.
    if ((endpoint() === '' || secret() === '') && wp_get_environment_type() !== 'production') {
        return;
    }

    $queued = queue();
    if (isset($queued[$setting])) {
        $event = $queued[$setting];
        $event['occurredAt'] = (int) floor(microtime(true) * 1000);
        queue($event);

        return;
    }
    $event = event_for($setting);
    record($setting, $event, ['status' => 'pending', 'attempts' => 0, 'queuedAt' => time()]);
    if ($queued === []) {
        add_action('shutdown', __NAMESPACE__ . '\\send_queued', 1001);
    }
    queue($event);
}

/** Sends a setting's event and records how it went. */
function deliver(string $setting, array $event): array
{
    $previous = recorded($setting);
    $attempts = $previous !== null && ($previous['event']['id'] ?? null) === $event['id']
        ? (int) ($previous['delivery']['attempts'] ?? 0)
        : 0;

    $outcome = send($event);
    $delivery = $outcome + ['attempts' => $attempts + 1, 'attemptedAt' => time()];
    // A newer event recorded meanwhile (another request) keeps its own state.
    $current = recorded($setting);
    if ($current === null || ($current['event']['id'] ?? null) === $event['id']) {
        record($setting, $event, $delivery);
    }

    if ($outcome['status'] !== 'refreshed') {
        error_log(sprintf(
            'Settings events: %s for %s was not refreshed (%s): %s',
            $event['id'],
            $setting,
            $outcome['reason'],
            $outcome['message'],
        ));
    }

    return $delivery;
}

/** Sends this request's events, after the editor's response where PHP-FPM allows. */
function send_queued(): void
{
    $queued = queue();
    if ($queued === []) {
        return;
    }
    if (function_exists('fastcgi_finish_request') && ! headers_sent()) {
        while (ob_get_level() > 0) {
            ob_end_flush();
        }
        fastcgi_finish_request();
    }
    foreach ($queued as $setting => $event) {
        deliver((string) $setting, $event);
    }
}

/** Whether a menu is shown somewhere: assigned to a theme location. */
function located(int $menu_id): bool
{
    return in_array($menu_id, array_map('intval', get_nav_menu_locations()), true);
}

/** Options: identity and the logo. The theme's mods hold the menu locations and the Customizer's logo. */
function option_changed(string $option, mixed $old = null, mixed $value = null): void
{
    if (isset(OPTIONS[$option])) {
        changed(OPTIONS[$option]);

        return;
    }
    if ($option !== 'theme_mods_' . get_option('stylesheet')) {
        return;
    }
    $old = is_array($old) ? $old : [];
    $value = is_array($value) ? $value : [];
    if (($old['nav_menu_locations'] ?? []) != ($value['nav_menu_locations'] ?? [])) {
        changed('menus');
    }
    if (($old['custom_logo'] ?? null) != ($value['custom_logo'] ?? null)) {
        changed('logo');
    }
}

add_action('updated_option', __NAMESPACE__ . '\\option_changed', 10, 3);
add_action('added_option', static fn(string $option, mixed $value) => option_changed($option, null, $value), 10, 2);
add_action('deleted_option', static fn(string $option) => option_changed($option), 10, 1);

add_action('wp_update_nav_menu', static function (int $menu_id): void {
    if (located($menu_id)) {
        changed('menus');
    }
}, 10, 1);
add_action('wp_update_nav_menu_item', static function (int $menu_id): void {
    if (located($menu_id)) {
        changed('menus');
    }
}, 10, 1);
add_action('wp_delete_nav_menu', static fn() => changed('menus'), 10, 0);
add_action('deleted_post', static function (int $post_id, ?WP_Post $post = null): void {
    if ($post instanceof WP_Post && $post->post_type === 'nav_menu_item') {
        changed('menus');
    }
}, 10, 2);

add_action('save_post_wp_global_styles', static fn() => changed('design'), 10, 0);
add_action('switch_theme', static function (): void {
    changed('design');
    changed('menus');
}, 10, 0);

if (defined('WP_CLI') && WP_CLI && available()) {
    /**
     * Settings events: what was sent to the Frontend for each shared setting,
     * and how it went.
     */
    \WP_CLI::add_command('gq-events settings', new class {
        /**
         * Lists each shared setting's last event and its delivery.
         *
         * ## OPTIONS
         *
         * [--format=<format>]
         * : table or json.
         * ---
         * default: table
         * ---
         */
        public function status(array $args, array $assoc): void
        {
            $rows = [];
            foreach (SETTINGS as $setting) {
                $recorded = recorded($setting);
                $rows[] = [
                    'setting' => $setting,
                    'event' => $recorded['event']['id'] ?? '',
                    'status' => $recorded['delivery']['status'] ?? 'none',
                    'reason' => $recorded['delivery']['reason'] ?? '',
                    'attempts' => $recorded['delivery']['attempts'] ?? 0,
                    'message' => $recorded['delivery']['message'] ?? '',
                ];
            }
            \WP_CLI\Utils\format_items($assoc['format'] ?? 'table', $rows, ['setting', 'event', 'status', 'reason', 'attempts', 'message']);
        }

        /**
         * Sends a setting's last event again (the same event, so the Frontend
         * recognises it), or a new one if it has none.
         *
         * <setting>
         * : menus, logo, identity or design.
         */
        public function retry(array $args): void
        {
            $setting = (string) $args[0];
            if (! in_array($setting, SETTINGS, true)) {
                \WP_CLI::error("No setting {$setting}; one of: " . implode(', ', SETTINGS) . '.');
            }
            $event = recorded($setting)['event'] ?? event_for($setting);
            $delivery = deliver($setting, $event);
            if ($delivery['status'] !== 'refreshed') {
                \WP_CLI::error("Not refreshed ({$delivery['reason']}): {$delivery['message']}");
            }
            \WP_CLI::success("Refreshed the {$setting} on the Frontend.");
        }
    });
}
