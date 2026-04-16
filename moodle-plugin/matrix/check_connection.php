<?php
// This file is part of Moodle - http://moodle.org/

/**
 * Matrix homeserver connection test & diagnostics page
 *
 * Called by the admin settings "Test connection" button.
 * Shows a complete configuration status table and runs several API tests
 * so administrators can immediately see what is working and what is not.
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/matrix/lib.php');

// ── Authentication & authorisation ───────────────────────────────────────────
$context = context_system::instance();

require_login();
require_sesskey();
require_capability('moodle/site:config', $context);

// ── Page setup ────────────────────────────────────────────────────────────────
$PAGE->set_context($context);
$PAGE->set_url(new moodle_url('/mod/matrix/check_connection.php', ['sesskey' => sesskey()]));
$PAGE->set_title(get_string('test_connection', 'mod_matrix'));
$PAGE->set_heading(get_string('test_connection', 'mod_matrix'));
$PAGE->set_pagelayout('admin');

$settings_url = new moodle_url('/admin/settings.php', ['section' => 'modsettingmatrix']);

// ── Read config ───────────────────────────────────────────────────────────────
$homeserver_url    = get_config('mod_matrix', 'homeserver_url')    ?: '';
$homeserver_domain = get_config('mod_matrix', 'homeserver_domain') ?: '';
$client_url        = get_config('mod_matrix', 'client_url')        ?: '';
$admin_token       = get_config('mod_matrix', 'admin_token')       ?: '';
$username_format   = get_config('mod_matrix', 'username_format')   ?: 'username';
$token_lifetime    = (int) (get_config('mod_matrix', 'token_lifetime') ?: 28800);
$api_timeout       = (int) (get_config('mod_matrix', 'api_timeout')    ?: 10);
$ssl_verify        = (bool) get_config('mod_matrix', 'ssl_verify');
$allow_iframe      = (bool) get_config('mod_matrix', 'allow_iframe');

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('test_connection', 'mod_matrix'));

// ── Configuration status table ────────────────────────────────────────────────
// Helper: render a status row.
function diag_row($label, $value, $ok) {
    $icon  = $ok ? '&#x2705;' : '&#x274C;';
    $class = $ok ? 'table-success' : 'table-danger';
    return html_writer::tag('tr',
        html_writer::tag('td', $label) .
        html_writer::tag('td', $icon . ' ' . s($value)),
        ['class' => $class]
    );
}
function diag_row_info($label, $value) {
    return html_writer::tag('tr',
        html_writer::tag('td', $label) .
        html_writer::tag('td', s($value))
    );
}

echo html_writer::tag('h4', get_string('diag_config', 'mod_matrix'));

$rows  = diag_row(get_string('homeserver_url', 'mod_matrix'),    $homeserver_url    ?: '—', !empty($homeserver_url));
$rows .= diag_row(get_string('homeserver_domain', 'mod_matrix'), $homeserver_domain ?: '—', !empty($homeserver_domain));
$rows .= diag_row(get_string('client_url', 'mod_matrix'),        $client_url        ?: '—', !empty($client_url));
$rows .= diag_row(get_string('admin_token', 'mod_matrix'),
    empty($admin_token) ? '—' : substr($admin_token, 0, 6) . str_repeat('*', 10),
    !empty($admin_token)
);
$rows .= diag_row_info(get_string('username_format', 'mod_matrix'), $username_format);
$rows .= diag_row_info(get_string('token_lifetime', 'mod_matrix'), ($token_lifetime / 3600) . ' h');
$rows .= diag_row_info(get_string('api_timeout', 'mod_matrix'),    $api_timeout . ' s');
$rows .= diag_row_info(get_string('ssl_verify', 'mod_matrix'),     $ssl_verify    ? '✔ enabled' : '✘ disabled (dev mode)');
$rows .= diag_row_info(get_string('allow_iframe', 'mod_matrix'),   $allow_iframe   ? '✔ enabled' : '✘ disabled');

echo html_writer::tag('table',
    html_writer::tag('thead',
        html_writer::tag('tr',
            html_writer::tag('th', get_string('diag_setting', 'mod_matrix')) .
            html_writer::tag('th', get_string('diag_value',   'mod_matrix'))
        )
    ) .
    html_writer::tag('tbody', $rows),
    ['class' => 'table table-bordered table-sm', 'style' => 'max-width:640px;']
);

echo html_writer::tag('p',
    html_writer::link($settings_url, '&#x2699;&#xFE0F; ' . get_string('diag_goto_settings', 'mod_matrix'),
        ['class' => 'btn btn-sm btn-outline-secondary'])
);

// ── Live API tests ────────────────────────────────────────────────────────────
if (empty($homeserver_url) || empty($admin_token)) {
    echo $OUTPUT->notification(get_string('diag_missing_required', 'mod_matrix'), 'warning');
} else {
    echo html_writer::tag('h4', get_string('diag_tests', 'mod_matrix'));

    $api = new \mod_matrix\matrix_api();

    // ── Test 1: Client API — whoami ──────────────────────────────────────
    echo html_writer::tag('p',
        html_writer::tag('strong', get_string('diag_test_whoami', 'mod_matrix'))
    );

    $whoami = $api->whoami();
    if ($whoami['success']) {
        echo $OUTPUT->notification(
            '&#x2705; ' . get_string('test_connection_success', 'mod_matrix', s($whoami['user_id'])),
            'success'
        );
    } else {
        echo $OUTPUT->notification(
            '&#x274C; ' . get_string('test_connection_failure', 'mod_matrix', s($whoami['error'])),
            'error'
        );
    }

    // ── Test 2: Synapse admin API — server version ───────────────────────
    echo html_writer::tag('p',
        html_writer::tag('strong', get_string('diag_test_admin', 'mod_matrix'))
    );

    $ver = $api->server_version();
    if ($ver['success']) {
        echo $OUTPUT->notification(
            '&#x2705; ' . get_string('diag_admin_ok', 'mod_matrix', s($ver['version'])),
            'success'
        );
    } else {
        echo $OUTPUT->notification(
            '&#x274C; ' . get_string('diag_admin_fail', 'mod_matrix', s($ver['error'])),
            'warning'
        );
    }

    // ── Test 3: SSL (only meaningful when ssl_verify is OFF) ─────────────
    if (!$ssl_verify) {
        echo $OUTPUT->notification(
            '&#x26A0;&#xFE0F; ' . get_string('diag_ssl_disabled', 'mod_matrix'),
            'warning'
        );
    }

    // ── Test 4: iframe embed check ───────────────────────────────────────
    if (!$allow_iframe) {
        echo $OUTPUT->notification(
            '&#x2139;&#xFE0F; ' . get_string('diag_iframe_disabled', 'mod_matrix'),
            'info'
        );
    }
}

echo html_writer::start_div('', ['style' => 'margin-top:24px;']);
echo html_writer::link(
    $settings_url,
    '&larr; ' . get_string('back'),
    ['class' => 'btn btn-secondary']
);
echo html_writer::end_div();

echo $OUTPUT->footer();
