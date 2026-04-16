<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * English language strings for mod_matrix
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

// ── Plugin metadata ───────────────────────────────────────────────────────────
$string['pluginname']           = 'Matrix Chat';
$string['modulename']           = 'Matrix Chat';
$string['modulenameplural']     = 'Matrix Chats';
$string['pluginadministration'] = 'Matrix Chat administration';
$string['modulename_help']      = 'The Matrix Chat activity allows students and teachers to communicate in real-time using a Matrix-based chat room directly embedded inside Moodle.';

// ── Activity form ─────────────────────────────────────────────────────────────
$string['activityname']          = 'Activity name';
$string['roomsettings']          = 'Matrix room settings';
$string['roomalias']             = 'Room alias';
$string['roomalias_help']        = 'The local part of the Matrix room alias (without the # and :server). Leave blank to generate automatically. Example: moodle-cs-101';
$string['roomalias_hint']        = 'Full alias will be: #{alias}:{$a}';
$string['roomalias_invalid']     = 'The room alias can only contain lowercase letters, numbers, hyphens (-) and dots (.).';
$string['roomid']                = 'Room ID (advanced)';
$string['roomid_help']           = 'The internal Matrix room ID (starts with !). Leave blank — it will be filled automatically when the room is created. You can also paste an existing room ID here to link to an existing room.';
$string['autocreateroom']        = 'Auto-create room';
$string['autocreateroom_desc']   = 'Automatically create the Matrix room on the homeserver when the activity is saved.';
$string['autocreateroom_help']   = 'When enabled, the plugin will call the Matrix API to create a room using the alias above. Requires a valid admin token in the plugin settings.';
$string['autoinviteusers']       = 'Auto-invite enrolled users';
$string['autoinviteusers_desc']  = 'Automatically invite all enrolled users to the Matrix room.';
$string['autoinviteusers_help']  = 'When a student opens this activity, they will be force-joined to the Matrix room without needing to accept an invitation.';
$string['displaymode']           = 'Display mode';
$string['displaymode_help']      = 'Choose how the Matrix client is shown to users. "Embedded" requires the Matrix client server to allow iframe embedding (X-Frame-Options / CSP frame-ancestors). If the iframe is blocked, use "New window" or "Redirect" instead.';
$string['displaymode_iframe']    = 'Embedded (inline iframe)';
$string['displaymode_newwindow'] = 'Open in new window';
$string['displaymode_redirect']  = 'Redirect directly to client';
$string['iframeheight']          = 'Iframe height (px)';
$string['iframeheight_min']      = 'The height must be at least 200 pixels.';

// ── View page ─────────────────────────────────────────────────────────────────
$string['roomaddress']      = 'Room address:';
$string['notconfigured']    = 'Matrix Chat is not yet configured. Please ask your administrator to set the homeserver URL and admin token in the plugin settings.';
$string['notconfigured_client'] = 'The Matrix client URL is not configured. Please ask your administrator to set the "Matrix client URL" in the plugin settings.';
$string['loading']          = 'Loading Matrix Chat…';
$string['openinnewwindow']  = 'Open in new window';
$string['launchchat']       = 'Open Matrix Chat';
$string['syncmembers']      = 'Sync members';
$string['syncmembers_hint'] = 'Force-join all enrolled users into this Matrix room.';
$string['syncmembers_done'] = 'Members synchronised successfully.';

// ── Admin settings ────────────────────────────────────────────────────────────
$string['settings_connection']      = 'Homeserver connection';
$string['settings_connection_desc'] = 'Configure the connection to your Matrix homeserver (Synapse, Conduit, Dendrite, etc.).';

$string['homeserver_url']      = 'Homeserver URL';
$string['homeserver_url_desc'] = 'The base URL of your Matrix homeserver. Example: <code>https://matrix.example.com</code>';

$string['homeserver_domain']             = 'Homeserver domain';
$string['homeserver_domain_desc']        = 'The Matrix server name used in user IDs and room aliases. Example: <code>example.com</code>';
$string['homeserver_domain_placeholder'] = 'your-server';

$string['client_url']      = 'Matrix client URL';
$string['client_url_desc'] = 'URL of the Matrix web client (Element, SENDT, Cinny, etc.). Example: <code>https://chat.example.com</code>';

$string['admin_token']      = 'Admin access token';
$string['admin_token_desc'] = 'Access token for a Matrix admin account. Used to create rooms, provision user accounts, and generate SSO login tokens. Obtain it via your homeserver admin panel or with: <code>curl -X POST https://&lt;homeserver&gt;/_matrix/client/v3/login -d \'{"type":"m.login.password","user":"@admin:&lt;domain&gt;","password":"PASSWORD"}\'</code>';

$string['settings_usermapping']      = 'User mapping';
$string['settings_usermapping_desc'] = 'How Moodle user accounts are mapped to Matrix user IDs.';

$string['username_format']          = 'Matrix username format';
$string['username_format_desc']     = 'Which Moodle field to use as the local part of the Matrix user ID (e.g. @<b>username</b>:server).';
$string['username_format_username'] = 'Moodle username';
$string['username_format_email']    = 'Email address (local part before @)';
$string['username_format_idnumber'] = 'ID number';

$string['settings_token']      = 'Session / token';
$string['settings_token_desc'] = 'Configure how long SSO login tokens remain valid. Longer tokens mean fewer re-authentications; shorter tokens are more secure. 8 hours is a good balance for a school day.';

$string['token_lifetime']      = 'SSO token lifetime';
$string['token_lifetime_desc'] = 'How long the Synapse-generated login token is valid. The iframe will automatically refresh 5 minutes before expiry so users are never logged out mid-session.';
$string['token_lifetime_1h']   = '1 hour';
$string['token_lifetime_4h']   = '4 hours';
$string['token_lifetime_8h']   = '8 hours (recommended)';
$string['token_lifetime_12h']  = '12 hours';
$string['token_lifetime_24h']  = '24 hours';

$string['settings_security']    = 'Security';
$string['allow_iframe']         = 'Allow iframe embedding';
$string['allow_iframe_desc']    = 'When enabled, the Matrix client is embedded inside Moodle pages via an iframe. Disable this if your Matrix client server sends X-Frame-Options: DENY or a restrictive CSP that prevents embedding, and use "New window" mode instead.';

$string['settings_advanced']      = 'Advanced / network';
$string['settings_advanced_desc'] = 'Fine-tune network behaviour. These defaults work for most deployments.';

$string['api_timeout']      = 'API request timeout (seconds)';
$string['api_timeout_desc'] = 'Maximum time to wait for a response from the homeserver. Increase this on slow or high-latency networks.';

$string['ssl_verify']      = 'Verify SSL certificate';
$string['ssl_verify_desc'] = 'Verify the homeserver TLS certificate. <strong>Disable only on local development servers with self-signed certificates.</strong> Never disable on production.';

$string['settings_test']      = 'Connection test';
$string['settings_test_desc'] = 'Use the button below to verify that Moodle can reach your Matrix homeserver with the configured admin token.';
$string['test_connection']         = 'Run diagnostics';
$string['test_connection_success'] = 'Connection successful! Logged in as: {$a}';
$string['test_connection_failure'] = 'Connection failed: {$a}';

// ── Diagnostics page ──────────────────────────────────────────────────────────
$string['diag_config']           = 'Configuration';
$string['diag_setting']          = 'Setting';
$string['diag_value']            = 'Value / status';
$string['diag_goto_settings']    = 'Edit settings';
$string['diag_missing_required'] = 'The homeserver URL and admin token must both be set before running tests.';
$string['diag_tests']            = 'Live tests';
$string['diag_test_whoami']      = 'Test 1 — Matrix Client API (whoami)';
$string['diag_test_admin']       = 'Test 2 — Synapse Admin API (server version)';
$string['diag_admin_ok']         = 'Synapse admin API accessible. Server version: {$a}';
$string['diag_admin_fail']       = 'Synapse admin API not accessible: {$a}. SSO token generation and force-join will not work.';
$string['diag_ssl_disabled']     = 'SSL certificate verification is DISABLED. This is only safe on local/dev environments.';
$string['diag_iframe_disabled']  = 'Iframe embedding is disabled in the plugin settings. Activities set to "Embedded" mode will display a button instead.';

// ── Capabilities ──────────────────────────────────────────────────────────────
$string['matrix:view']          = 'View Matrix Chat activity';
$string['matrix:addinstance']   = 'Add a Matrix Chat activity';
$string['matrix:managemembers'] = 'Manage Matrix room members';

// ── Events ────────────────────────────────────────────────────────────────────
$string['eventcoursemoduleviewed'] = 'Matrix Chat activity viewed';

// ── Privacy ───────────────────────────────────────────────────────────────────
$string['privacy:metadata:matrix_rooms']            = 'Information about the Matrix rooms linked to Moodle courses.';
$string['privacy:metadata:matrix_rooms:room_id']    = 'The Matrix room ID.';
$string['privacy:metadata:matrix_rooms:room_alias'] = 'The Matrix room alias.';
$string['privacy:metadata:external_matrix']         = 'The plugin communicates with an external Matrix homeserver. The user\'s Matrix ID (derived from their Moodle username) is transmitted to the homeserver for room membership management.';
