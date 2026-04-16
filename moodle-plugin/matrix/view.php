<?php
// This file is part of Moodle - http://moodle.org/

/**
 * Matrix Chat activity — view page
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/matrix/lib.php');

global $DB, $OUTPUT, $PAGE, $USER, $CFG;

// ── Resolve course module ─────────────────────────────────────────────────────
$id     = optional_param('id', 0, PARAM_INT);   // course module id
$m      = optional_param('m',  0, PARAM_INT);   // matrix instance id
$action = optional_param('action', '', PARAM_ALPHA);

if ($id) {
    $cm       = get_coursemodule_from_id('matrix', $id, 0, false, MUST_EXIST);
    $course   = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
    $instance = $DB->get_record('matrix', ['id' => $cm->instance], '*', MUST_EXIST);
} elseif ($m) {
    $instance = $DB->get_record('matrix', ['id' => $m], '*', MUST_EXIST);
    $course   = $DB->get_record('course', ['id' => $instance->course], '*', MUST_EXIST);
    $cm       = get_coursemodule_from_instance('matrix', $instance->id, $course->id, false, MUST_EXIST);
} else {
    throw new moodle_exception('missingparam', '', '', 'id');
}

// ── Authentication ────────────────────────────────────────────────────────────
require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/matrix:view', $context);

// ── Page setup ────────────────────────────────────────────────────────────────
$PAGE->set_url('/mod/matrix/view.php', ['id' => $cm->id]);
$PAGE->set_title(format_string($instance->name));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->set_context($context);

// ── Log view event ────────────────────────────────────────────────────────────
$event = \mod_matrix\event\course_module_viewed::create([
    'objectid' => $instance->id,
    'context'  => $context,
]);
$event->add_record_snapshot('course_modules', $cm);
$event->add_record_snapshot('course', $course);
$event->add_record_snapshot('matrix', $instance);
$event->trigger();

// ── Auto-create room if needed ────────────────────────────────────────────────
if (empty($instance->room_id) && !empty($instance->autocreate_room)) {
    try {
        $room_id = matrix_ensure_room_exists($instance);
        if ($room_id) {
            $instance->room_id = $room_id;
        }
    } catch (Throwable $e) {
        debugging('mod_matrix: could not auto-create room: ' . $e->getMessage(), DEBUG_DEVELOPER);
    }
}

// ── Handle sync action (teachers only) ───────────────────────────────────────
$sync_done = false;
if ($action === 'sync' && has_capability('mod/matrix:managemembers', $context)) {
    require_sesskey();
    try {
        matrix_sync_room_members($instance, $course->id);
        $sync_done = true;
    } catch (Throwable $e) {
        debugging('mod_matrix: sync failed: ' . $e->getMessage(), DEBUG_DEVELOPER);
    }
}

// ── Force-join current user (and all enrolled users for teachers) ─────────────
if (!empty($instance->room_id)) {
    if (has_capability('mod/matrix:managemembers', $context)) {
        try {
            matrix_sync_room_members($instance, $course->id);
        } catch (Throwable $e) {
            debugging('mod_matrix: bulk join failed: ' . $e->getMessage(), DEBUG_DEVELOPER);
        }
    } else {
        try {
            $api            = new \mod_matrix\matrix_api();
            $matrix_user_id = matrix_get_matrix_userid($USER);
            if ($api->is_configured() && $matrix_user_id) {
                $display_name = trim(($USER->firstname ?? '') . ' ' . ($USER->lastname ?? ''));
                $api->ensure_user_exists($matrix_user_id, $display_name ?: $matrix_user_id);
                $api->force_join_user($instance->room_id, $matrix_user_id);
            }
        } catch (Throwable $e) {
            debugging('mod_matrix: self-join failed: ' . $e->getMessage(), DEBUG_DEVELOPER);
        }
    }
}

// ── Determine display mode ────────────────────────────────────────────────────
// The admin can globally disable iframe embedding (e.g. if the Moodle server's
// CSP or the Matrix client's X-Frame-Options policy blocks it). When disabled,
// fall back to "newwindow" regardless of what was set on the activity.
$display_mode     = $instance->display_mode ?? 'iframe';
$allow_iframe_cfg = (bool) get_config('mod_matrix', 'allow_iframe');
if (!$allow_iframe_cfg && $display_mode === 'iframe') {
    $display_mode = 'newwindow';
}

// ── Build client URL (SSO or fallback) ───────────────────────────────────────
$client_url = matrix_get_client_url($instance, $USER);

// Hard redirect — skip page rendering entirely.
if ($display_mode === 'redirect') {
    if (empty($client_url)) {
        // Plugin not configured — show admin warning rather than redirecting nowhere.
        $display_mode = 'newwindow';
    } else {
        redirect($client_url);
    }
}

// ── Compute token refresh interval for JS (avoid mid-session expiry) ─────────
// The iframe will auto-reload 5 minutes before the token expires so users
// always have a valid session without needing to manually refresh the page.
$token_lifetime  = (int) (get_config('mod_matrix', 'token_lifetime') ?: 28800);
// Refresh 5 minutes before expiry; minimum 60 s to avoid thrashing.
$js_refresh_ms   = max(60, $token_lifetime - 300) * 1000;

// ── Render page ───────────────────────────────────────────────────────────────
echo $OUTPUT->header();
echo $OUTPUT->heading(format_string($instance->name), 2);

// Description.
if (!empty($instance->intro)) {
    echo $OUTPUT->box(
        format_module_intro('matrix', $instance, $cm->id),
        'generalbox mod_introbox',
        'matrixintro'
    );
}

// ── Not configured warnings ───────────────────────────────────────────────────
if (empty(get_config('mod_matrix', 'homeserver_url'))) {
    echo $OUTPUT->notification(get_string('notconfigured', 'mod_matrix'), 'warning');
}

if (empty($client_url)) {
    echo $OUTPUT->notification(get_string('notconfigured_client', 'mod_matrix'), 'warning');
}

// ── Sync done notification ────────────────────────────────────────────────────
if ($sync_done) {
    echo $OUTPUT->notification(get_string('syncmembers_done', 'mod_matrix'), 'success');
}

// ── Room address info bar ─────────────────────────────────────────────────────
$homeserver_domain = get_config('mod_matrix', 'homeserver_domain');
$room_display = '';
if (!empty($instance->room_alias) && $homeserver_domain) {
    $room_display = '#' . $instance->room_alias . ':' . $homeserver_domain;
} elseif (!empty($instance->room_id)) {
    $room_display = $instance->room_id;
}
if ($room_display) {
    echo html_writer::div(
        html_writer::span(get_string('roomaddress', 'mod_matrix') . ' ') .
        html_writer::tag('code', s($room_display)),
        'alert alert-info matrix-room-info'
    );
}

// ── Main display ──────────────────────────────────────────────────────────────
if (!empty($client_url)) {

    if ($display_mode === 'iframe') {
        $height    = max(300, (int)($instance->iframe_height ?? 700));
        $iframe_id = 'matrix-iframe-' . $cm->id;

        echo html_writer::start_div('matrix-iframe-wrapper', [
            'style' => 'position:relative; width:100%; border:1px solid #dee2e6;'
                     . ' border-radius:6px; overflow:hidden; background:#111;',
        ]);

        // Loading overlay — hidden once iframe fires the load event.
        echo html_writer::start_div('matrix-loading-overlay', [
            'id'    => 'matrix-loading-' . $cm->id,
            'style' => 'position:absolute; top:0; left:0; width:100%; height:100%;'
                     . ' display:flex; flex-direction:column; align-items:center;'
                     . ' justify-content:center; background:#111; color:#aaa;'
                     . ' z-index:10; pointer-events:none;',
        ]);
        echo html_writer::tag('p',
            html_writer::tag('i', '', ['class' => 'fa fa-spinner fa-spin fa-2x',
                                        'style' => 'color:#0dbd8b;'])
        );
        echo html_writer::tag('p', get_string('loading', 'mod_matrix'),
            ['style' => 'font-size:.9rem; margin-top:8px;']);
        echo html_writer::end_div();

        echo html_writer::tag('iframe', '', [
            'src'             => $client_url,
            'width'           => '100%',
            'height'          => $height . 'px',
            'frameborder'     => '0',
            'allowfullscreen' => 'true',
            'allow'           => 'microphone; camera; fullscreen; display-capture',
            'title'           => s(format_string($instance->name)),
            'style'           => 'display:block; border:none;',
            'id'              => $iframe_id,
            'loading'         => 'eager',
        ]);

        // CSP-safe script: hide overlay on load + auto-refresh before token expires.
        $loading_id  = 'matrix-loading-' . $cm->id;
        echo html_writer::script(
            "(function() {" .
            "  var iframe = document.getElementById('" . $iframe_id . "');" .
            "  var overlay = document.getElementById('" . $loading_id . "');" .
            // Hide loading overlay when iframe content is ready.
            "  iframe.addEventListener('load', function() {" .
            "    if (overlay) overlay.style.display = 'none';" .
            "  });" .
            // Auto-refresh the iframe before the SSO token expires so the user
            // never sees a "Token no longer valid" logout mid-session.
            "  setTimeout(function() {" .
            "    if (document.getElementById('" . $iframe_id . "')) {" .
            "      iframe.src = iframe.src;" .
            "    }" .
            "  }, " . (int)$js_refresh_ms . ");" .
            "})();"
        );

        echo html_writer::end_div();

        // "Open in new window" link below iframe.
        echo html_writer::start_div('', ['style' => 'margin-top:8px; text-align:right;']);
        echo html_writer::link(
            $client_url,
            get_string('openinnewwindow', 'mod_matrix'),
            ['target' => '_blank', 'class' => 'btn btn-sm btn-outline-secondary',
             'rel' => 'noopener noreferrer']
        );
        echo html_writer::end_div();

    } else {
        // New-window / button mode.
        echo html_writer::start_div('', ['style' => 'text-align:center; padding:48px 0;']);
        echo html_writer::tag('p',
            html_writer::tag('i', '', ['class' => 'fa fa-comments fa-3x', 'style' => 'color:#0dbd8b;'])
        );
        echo html_writer::link(
            $client_url,
            get_string('launchchat', 'mod_matrix'),
            ['target' => '_blank',
             'class'  => 'btn btn-primary btn-lg',
             'rel'    => 'noopener noreferrer']
        );
        echo html_writer::end_div();
    }
}

// ── Teacher: "Sync members" button ────────────────────────────────────────────
if (has_capability('mod/matrix:managemembers', $context) && !empty($instance->room_id)) {
    $sync_url = new moodle_url('/mod/matrix/view.php',
        ['id' => $cm->id, 'action' => 'sync', 'sesskey' => sesskey()]);

    echo html_writer::start_div('', ['style' => 'margin-top:24px; padding-top:16px;'
        . ' border-top:1px solid #dee2e6;']);
    echo html_writer::link(
        $sync_url,
        get_string('syncmembers', 'mod_matrix'),
        ['class' => 'btn btn-sm btn-secondary']
    );
    echo html_writer::tag('small',
        ' ' . get_string('syncmembers_hint', 'mod_matrix'),
        ['class' => 'text-muted']
    );
    echo html_writer::end_div();
}

echo $OUTPUT->footer();
