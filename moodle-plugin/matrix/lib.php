<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Library of functions and constants for module matrix
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

// ── Compatibility constants ───────────────────────────────────────────────────
// MOD_PURPOSE_COMMUNICATION was introduced in Moodle 4.0. Define a fallback so
// the plugin loads cleanly even on older branches during testing.
if (!defined('MOD_PURPOSE_COMMUNICATION')) {
    define('MOD_PURPOSE_COMMUNICATION', 'communication');
}

/**
 * Add a new matrix instance to the database.
 *
 * @param stdClass $data Data from the mod_form
 * @return int The instance ID
 */
function matrix_add_instance($data) {
    global $DB;

    $data->timecreated  = time();
    $data->timemodified = time();

    if (empty($data->intro)) {
        $data->intro = '';
    }
    if (empty($data->introformat)) {
        $data->introformat = FORMAT_HTML;
    }

    if (!empty($data->room_alias)) {
        $data->room_alias = matrix_sanitize_alias($data->room_alias);
    }

    $data->id = $DB->insert_record('matrix', $data);

    if (!empty($data->autocreate_room)) {
        matrix_ensure_room_exists($data);
        // Reload instance to get room_id after creation.
        $data = $DB->get_record('matrix', ['id' => $data->id]);
    }

    // Immediately force-join all enrolled users (no invitation acceptance needed).
    if (!empty($data->autoinvite_users) && !empty($data->room_id)) {
        matrix_sync_room_members($data, $data->course);
    }

    return $data->id;
}

/**
 * Update an existing matrix instance.
 *
 * @param stdClass $data
 * @return bool
 */
function matrix_update_instance($data) {
    global $DB;

    $data->timemodified = time();
    $data->id = $data->instance;

    if (!empty($data->room_alias)) {
        $data->room_alias = matrix_sanitize_alias($data->room_alias);
    }

    return $DB->update_record('matrix', $data);
}

/**
 * Delete a matrix instance.
 *
 * @param int $id
 * @return bool
 */
function matrix_delete_instance($id) {
    global $DB;

    if (!$instance = $DB->get_record('matrix', ['id' => $id])) {
        return false;
    }

    $DB->delete_records('matrix', ['id' => $id]);
    return true;
}

/**
 * Returns the information on whether the module supports a given feature.
 *
 * @param string $feature FEATURE_xx constant for requested feature
 * @return mixed true if feature is supported, null if unknown
 */
function matrix_supports($feature) {
    switch ($feature) {
        case FEATURE_MOD_INTRO:
            return true;
        case FEATURE_SHOW_DESCRIPTION:
            return true;
        case FEATURE_BACKUP_MOODLE2:
            return true;
        case FEATURE_MOD_PURPOSE:
            return MOD_PURPOSE_COMMUNICATION;
        default:
            return null;
    }
}

/**
 * Sanitize a Matrix room alias (lowercase, alphanumeric + hyphens + dots only).
 *
 * @param string $alias
 * @return string
 */
function matrix_sanitize_alias($alias) {
    $alias = strtolower(trim($alias));
    $alias = preg_replace('/[^a-z0-9\-_\.]/', '-', $alias);
    $alias = preg_replace('/-+/', '-', $alias);
    return trim($alias, '-');
}

/**
 * Build the Matrix @user:domain ID for a given Moodle user.
 *
 * @param stdClass $user
 * @return string|null  e.g. @john.doe:matrix.example.com, or null if not configured
 */
function matrix_get_matrix_userid($user) {
    $format     = get_config('mod_matrix', 'username_format');
    $homeserver = get_config('mod_matrix', 'homeserver_domain');

    if (empty($homeserver)) {
        return null;
    }

    switch ($format) {
        case 'email_local':
            $parts = explode('@', $user->email ?? '');
            $local = strtolower($parts[0] ?? $user->username);
            break;
        case 'idnumber':
            $local = strtolower(!empty($user->idnumber) ? $user->idnumber : $user->username);
            break;
        case 'username':
        default:
            $local = strtolower($user->username);
            break;
    }

    // Matrix local parts allow [a-z0-9._\-=/+]
    $local = preg_replace('/[^a-z0-9\.\-\_\=\/\+]/', '_', $local);

    if (empty($local)) {
        return null;
    }

    return '@' . $local . ':' . $homeserver;
}

/**
 * Ensure the Matrix room exists for the given instance.
 * Creates it via the Matrix API if it does not exist yet.
 *
 * @param stdClass $instance  matrix module record
 * @return string|null        room_id or null on failure
 */
function matrix_ensure_room_exists($instance) {
    global $DB;

    if (!empty($instance->room_id)) {
        return $instance->room_id;
    }

    $api = new \mod_matrix\matrix_api();
    if (!$api->is_configured()) {
        return null;
    }

    $alias   = !empty($instance->room_alias)
        ? $instance->room_alias
        : 'moodle-' . $instance->id;

    $room_id = $api->create_room(
        $instance->name,
        $alias,
        strip_tags($instance->intro ?? '')
    );

    if ($room_id) {
        $DB->set_field('matrix', 'room_id',    $room_id, ['id' => $instance->id]);
        $DB->set_field('matrix', 'room_alias', $alias,   ['id' => $instance->id]);
    }

    return $room_id;
}

/**
 * Force-join all Moodle-enrolled users into the Matrix room.
 *
 * Uses the Synapse admin API to add users directly as members without
 * requiring them to accept an invitation. Each user's Matrix account is
 * created first if it does not already exist on the homeserver.
 *
 * @param stdClass $instance
 * @param int      $courseid
 */
function matrix_sync_room_members($instance, $courseid) {
    if (empty($instance->room_id)) {
        return;
    }

    $api = new \mod_matrix\matrix_api();
    if (!$api->is_configured()) {
        return;
    }

    $context = context_course::instance($courseid);
    $users   = get_enrolled_users($context);

    foreach ($users as $user) {
        $matrix_userid = matrix_get_matrix_userid($user);
        if (!$matrix_userid) {
            continue;
        }

        // Ensure the Matrix account exists before joining.
        $display_name = trim(($user->firstname ?? '') . ' ' . ($user->lastname ?? ''));
        $api->ensure_user_exists($matrix_userid, $display_name ?: $matrix_userid);

        // Force-join: user is immediately a member, no acceptance needed.
        $api->force_join_user($instance->room_id, $matrix_userid);
    }
}

/**
 * Build the Matrix client URL for the current user and given instance.
 *
 * When the Synapse admin token is configured, generates a SSO deep-link:
 *   https://<client_url>/#moodle-sso?token=TOKEN;user=USER_ID;room=ROOM_ID
 *
 * Semicolons are used as query-string separators instead of & to prevent
 * Moodle's html_writer from HTML-encoding them to &amp; in attribute values,
 * which browsers would keep literally in the URL fragment and break parsing.
 *
 * The token is cached in the PHP session for (token_lifetime - 15 min) so
 * we avoid an API call on every page view while still refreshing well before
 * the token expires.
 *
 * Falls back to the plain client /#login URL when:
 *  - The plugin is not configured (no homeserver URL or client URL)
 *  - The user has no resolvable Matrix ID
 *  - The Synapse admin API returns null (e.g. for the admin account itself)
 *
 * Returns an empty string when the client URL is not configured at all,
 * so callers can detect this and show a "not configured" message.
 *
 * @param stdClass      $instance  matrix module record
 * @param stdClass|null $user      Moodle user (defaults to $USER)
 * @return string  Full URL, or empty string if the client URL is not set
 */
function matrix_get_client_url($instance, $user = null) {
    global $USER;

    $client_url = rtrim(get_config('mod_matrix', 'client_url') ?: '', '/');

    // Return empty string so the caller can show a proper "not configured" UI.
    if (empty($client_url)) {
        return '';
    }

    if ($user === null) {
        $user = $USER;
    }

    // Build the Matrix room reference.
    $homeserver_domain = get_config('mod_matrix', 'homeserver_domain');
    $room_ref = '';
    if (!empty($instance->room_id)) {
        $room_ref = $instance->room_id;
    } elseif (!empty($instance->room_alias) && $homeserver_domain) {
        $room_ref = '#' . $instance->room_alias . ':' . $homeserver_domain;
    }

    // Attempt SSO autologin.
    $api            = new \mod_matrix\matrix_api();
    $matrix_user_id = matrix_get_matrix_userid($user);

    if ($api->is_configured() && $matrix_user_id) {
        // ── Session token cache ───────────────────────────────────────────────
        // Key includes user ID so different users don't share tokens.
        $cache_key     = 'matrix_sso_tok_' . md5($matrix_user_id);
        $cache_exp_key = 'matrix_sso_exp_' . md5($matrix_user_id);

        $token = null;
        if (!empty($_SESSION[$cache_key]) && !empty($_SESSION[$cache_exp_key])
                && $_SESSION[$cache_exp_key] > time()) {
            $token = $_SESSION[$cache_key];
        } else {
            try {
                // Ensure user account exists on the homeserver.
                $display_name = trim(($user->firstname ?? '') . ' ' . ($user->lastname ?? ''));
                $api->ensure_user_exists($matrix_user_id, $display_name ?: $matrix_user_id);

                // Token lifetime from config (default 8 hours).
                $token_lifetime = (int) (get_config('mod_matrix', 'token_lifetime') ?: 28800);

                // Generate the login token.
                // Returns null for the Synapse admin account itself (API limitation).
                $token = $api->get_user_login_token($matrix_user_id, $token_lifetime);

                if ($token) {
                    // Cache until 15 minutes before expiry to refresh proactively.
                    $_SESSION[$cache_key]     = $token;
                    $_SESSION[$cache_exp_key] = time() + max(60, $token_lifetime - 900);
                }
            } catch (Throwable $e) {
                // SSO failed — fall through to plain client URL.
                $token = null;
            }
        }

        if ($token) {
            // Use ';' as separator to avoid '&' being HTML-encoded to '&amp;'
            // by Moodle's html_writer when used in iframe src / link href attributes.
            $params = http_build_query([
                'token' => $token,
                'user'  => $matrix_user_id,
                'room'  => $room_ref,
            ], '', ';');
            return $client_url . '/#moodle-sso?' . $params;
        }
    }

    // Fallback: open client login page directly (skip the landing page).
    return $client_url . '/#login';
}

/**
 * Invalidate the SSO token cache for a given Matrix user ID.
 * Call this if you need to force a fresh token on the next page load.
 *
 * @param string $matrix_user_id  e.g. @john:server
 */
function matrix_clear_sso_cache($matrix_user_id) {
    $key = md5($matrix_user_id);
    unset($_SESSION['matrix_sso_tok_' . $key]);
    unset($_SESSION['matrix_sso_exp_' . $key]);
}

/**
 * Returns cached_cm_info for the course module listing.
 *
 * @param stdClass $coursemodule
 * @return cached_cm_info
 */
function matrix_get_coursemodule_info($coursemodule) {
    global $DB;

    $instance = $DB->get_record('matrix', ['id' => $coursemodule->instance], '*', MUST_EXIST);

    $info       = new cached_cm_info();
    $info->name = $instance->name;

    if ($coursemodule->showdescription) {
        $info->content = format_module_intro('matrix', $instance, $coursemodule->id, false);
    }

    return $info;
}
