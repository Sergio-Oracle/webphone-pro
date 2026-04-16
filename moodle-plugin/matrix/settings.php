<?php
// This file is part of Moodle - http://moodle.org/

/**
 * Admin settings for mod_matrix
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

if ($ADMIN->fulltree) {

    // ── Connection settings ───────────────────────────────────────────────────
    $settings->add(new admin_setting_heading(
        'mod_matrix/connection_heading',
        get_string('settings_connection', 'mod_matrix'),
        get_string('settings_connection_desc', 'mod_matrix')
    ));

    // Matrix homeserver URL — no default (admin must fill it for their server).
    $settings->add(new admin_setting_configtext(
        'mod_matrix/homeserver_url',
        get_string('homeserver_url', 'mod_matrix'),
        get_string('homeserver_url_desc', 'mod_matrix'),
        '',
        PARAM_URL
    ));

    // Matrix homeserver domain — no default.
    $settings->add(new admin_setting_configtext(
        'mod_matrix/homeserver_domain',
        get_string('homeserver_domain', 'mod_matrix'),
        get_string('homeserver_domain_desc', 'mod_matrix'),
        '',
        PARAM_HOST
    ));

    // Matrix web client URL — no default.
    $settings->add(new admin_setting_configtext(
        'mod_matrix/client_url',
        get_string('client_url', 'mod_matrix'),
        get_string('client_url_desc', 'mod_matrix'),
        '',
        PARAM_URL
    ));

    // Admin access token.
    $settings->add(new admin_setting_configpasswordunmask(
        'mod_matrix/admin_token',
        get_string('admin_token', 'mod_matrix'),
        get_string('admin_token_desc', 'mod_matrix'),
        '',
        PARAM_RAW
    ));

    // ── User mapping ──────────────────────────────────────────────────────────
    $settings->add(new admin_setting_heading(
        'mod_matrix/usermapping_heading',
        get_string('settings_usermapping', 'mod_matrix'),
        get_string('settings_usermapping_desc', 'mod_matrix')
    ));

    $settings->add(new admin_setting_configselect(
        'mod_matrix/username_format',
        get_string('username_format', 'mod_matrix'),
        get_string('username_format_desc', 'mod_matrix'),
        'username',
        [
            'username'    => get_string('username_format_username', 'mod_matrix'),
            'email_local' => get_string('username_format_email',    'mod_matrix'),
            'idnumber'    => get_string('username_format_idnumber', 'mod_matrix'),
        ]
    ));

    // ── Token / session settings ──────────────────────────────────────────────
    $settings->add(new admin_setting_heading(
        'mod_matrix/token_heading',
        get_string('settings_token', 'mod_matrix'),
        get_string('settings_token_desc', 'mod_matrix')
    ));

    // How long the Synapse-generated login token remains valid.
    $settings->add(new admin_setting_configselect(
        'mod_matrix/token_lifetime',
        get_string('token_lifetime', 'mod_matrix'),
        get_string('token_lifetime_desc', 'mod_matrix'),
        '28800',  // 8 hours default
        [
            '3600'  => get_string('token_lifetime_1h',  'mod_matrix'),
            '14400' => get_string('token_lifetime_4h',  'mod_matrix'),
            '28800' => get_string('token_lifetime_8h',  'mod_matrix'),
            '43200' => get_string('token_lifetime_12h', 'mod_matrix'),
            '86400' => get_string('token_lifetime_24h', 'mod_matrix'),
        ]
    ));

    // ── Security ──────────────────────────────────────────────────────────────
    $settings->add(new admin_setting_heading(
        'mod_matrix/security_heading',
        get_string('settings_security', 'mod_matrix'),
        ''
    ));

    $settings->add(new admin_setting_configcheckbox(
        'mod_matrix/allow_iframe',
        get_string('allow_iframe', 'mod_matrix'),
        get_string('allow_iframe_desc', 'mod_matrix'),
        1
    ));

    // ── Advanced / network ────────────────────────────────────────────────────
    $settings->add(new admin_setting_heading(
        'mod_matrix/advanced_heading',
        get_string('settings_advanced', 'mod_matrix'),
        get_string('settings_advanced_desc', 'mod_matrix')
    ));

    // HTTP timeout for API calls (useful on slow or distant homeservers).
    $settings->add(new admin_setting_configtext(
        'mod_matrix/api_timeout',
        get_string('api_timeout', 'mod_matrix'),
        get_string('api_timeout_desc', 'mod_matrix'),
        '10',
        PARAM_INT
    ));

    // SSL verification — disable ONLY for local/dev environments with self-signed certs.
    $settings->add(new admin_setting_configcheckbox(
        'mod_matrix/ssl_verify',
        get_string('ssl_verify', 'mod_matrix'),
        get_string('ssl_verify_desc', 'mod_matrix'),
        1
    ));

    // ── Connection test ───────────────────────────────────────────────────────
    $settings->add(new admin_setting_heading(
        'mod_matrix/test_heading',
        get_string('settings_test', 'mod_matrix'),
        get_string('settings_test_desc', 'mod_matrix')
    ));

    $test_url = new moodle_url('/mod/matrix/check_connection.php', ['sesskey' => sesskey()]);
    $settings->add(new admin_setting_description(
        'mod_matrix/test_connection_link',
        '',
        html_writer::link(
            $test_url,
            get_string('test_connection', 'mod_matrix'),
            ['class' => 'btn btn-secondary', 'target' => '_blank']
        )
    ));
}
