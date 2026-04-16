<?php
// This file is part of Moodle - http://moodle.org/

/**
 * Matrix Client-Server API wrapper
 *
 * Implements the subset of the Matrix spec needed by mod_matrix:
 *   - whoami              GET  /_matrix/client/v3/account/whoami
 *   - create_room         POST /_matrix/client/v3/createRoom
 *   - invite_user         POST /_matrix/client/v3/rooms/{roomId}/invite
 *   - resolve_alias       GET  /_matrix/client/v3/directory/room/{roomAlias}
 *   - get_user_login_token POST /_synapse/admin/v1/users/{userId}/login  (Synapse admin)
 *   - ensure_user_exists  PUT  /_synapse/admin/v2/users/{userId}         (Synapse admin)
 *   - force_join_user     POST /_synapse/admin/v1/join/{roomId}          (Synapse admin)
 *
 * All HTTP options (timeout, SSL verification) are read from plugin config so
 * they can be adjusted per-deployment without touching code.
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_matrix;

defined('MOODLE_INTERNAL') || die();

class matrix_api {

    /** @var string Matrix homeserver base URL */
    private $homeserver_url;

    /** @var string Admin access token */
    private $token;

    /** @var int HTTP timeout in seconds */
    private $timeout;

    /** @var bool Whether to verify the homeserver SSL certificate */
    private $ssl_verify;

    public function __construct() {
        $this->homeserver_url = rtrim(get_config('mod_matrix', 'homeserver_url') ?: '', '/');
        $this->token          = get_config('mod_matrix', 'admin_token') ?: '';

        // Read network settings — safe defaults that work on any server.
        $timeout          = (int) get_config('mod_matrix', 'api_timeout');
        $this->timeout    = ($timeout > 0) ? $timeout : 10;

        // SSL verification is ON by default; can be disabled for dev/staging
        // environments that use self-signed certificates.
        $ssl_cfg          = get_config('mod_matrix', 'ssl_verify');
        $this->ssl_verify = ($ssl_cfg === false) ? true : (bool) $ssl_cfg;
    }

    // ── Public interface ──────────────────────────────────────────────────────

    /**
     * Check if the API is configured and usable.
     *
     * @return bool
     */
    public function is_configured(): bool {
        return !empty($this->homeserver_url) && !empty($this->token);
    }

    /**
     * Test the connection. Returns the user ID on success.
     *
     * @return array ['success' => bool, 'user_id' => string|null, 'error' => string|null]
     */
    public function whoami(): array {
        $result = $this->request('GET', '/_matrix/client/v3/account/whoami');

        if (isset($result['user_id'])) {
            return ['success' => true, 'user_id' => $result['user_id'], 'error' => null];
        }

        $error = $result['error'] ?? ($result['errcode'] ?? 'Unknown error');
        return ['success' => false, 'user_id' => null, 'error' => $error];
    }

    /**
     * Test access to the Synapse admin API.
     * Returns the server version string on success, or null on failure.
     *
     * @return array ['success' => bool, 'version' => string|null, 'error' => string|null]
     */
    public function server_version(): array {
        $result = $this->request('GET', '/_synapse/admin/v1/server_version');

        if (isset($result['server_version'])) {
            return ['success' => true, 'version' => $result['server_version'], 'error' => null];
        }

        $error = $result['error'] ?? ($result['errcode'] ?? 'Unknown error');
        return ['success' => false, 'version' => null, 'error' => $error];
    }

    /**
     * Force-join a user into a room using the Synapse admin API.
     *
     * Unlike invite_user(), this bypasses the invitation workflow:
     * the user is immediately a full member without any acceptance step.
     *
     * Requires: POST /_synapse/admin/v1/join/{roomIdOrAlias}
     *
     * @param string $room_id   Matrix room ID (e.g. !abc:server) or alias (#name:server)
     * @param string $user_id   Matrix user ID (e.g. @user:server)
     * @return bool
     */
    public function force_join_user(string $room_id, string $user_id): bool {
        if (empty($room_id) || empty($user_id)) {
            return false;
        }
        $result = $this->request(
            'POST',
            '/_synapse/admin/v1/join/' . rawurlencode($room_id),
            ['user_id' => $user_id]
        );
        // Success returns {'room_id': '!...'}
        return isset($result['room_id']);
    }

    /**
     * Create a Matrix room.
     *
     * @param string $name        Human-readable room name
     * @param string $alias       Local alias (without # and :server)
     * @param string $topic       Room topic (optional)
     * @param bool   $public      Whether the room is publicly joinable
     * @return string|null        The room_id (e.g. !abc123:server) or null on failure
     */
    public function create_room(string $name, string $alias = '', string $topic = '', bool $public = false): ?string {
        // First check if the room already exists via alias.
        if ($alias) {
            $homeserver_domain = get_config('mod_matrix', 'homeserver_domain');
            $full_alias        = '#' . $alias . ':' . $homeserver_domain;
            $existing          = $this->resolve_alias($full_alias);
            if ($existing) {
                return $existing;
            }
        }

        $body = [
            'name'       => $name,
            'preset'     => $public ? 'public_chat' : 'private_chat',
            'visibility' => $public ? 'public' : 'private',
        ];

        if ($alias) {
            $body['room_alias_name'] = $alias;
        }

        if ($topic) {
            $body['topic'] = strip_tags($topic);
        }

        // Initial state: make room history visible to members; no guest access.
        $body['initial_state'] = [
            [
                'type'      => 'm.room.history_visibility',
                'state_key' => '',
                'content'   => ['history_visibility' => 'shared'],
            ],
            [
                'type'      => 'm.room.guest_access',
                'state_key' => '',
                'content'   => ['guest_access' => 'forbidden'],
            ],
        ];

        $result = $this->request('POST', '/_matrix/client/v3/createRoom', $body);

        return $result['room_id'] ?? null;
    }

    /**
     * Invite a user to a room.
     *
     * @param string $room_id
     * @param string $user_id
     * @return bool
     */
    public function invite_user(string $room_id, string $user_id): bool {
        if (empty($room_id) || empty($user_id)) {
            return false;
        }

        $result = $this->request('POST',
            '/_matrix/client/v3/rooms/' . rawurlencode($room_id) . '/invite',
            ['user_id' => $user_id]
        );

        if (isset($result['errcode'])) {
            // M_FORBIDDEN / M_BAD_STATE = user is already a member — acceptable.
            return in_array($result['errcode'], ['M_FORBIDDEN', 'M_BAD_STATE'], true);
        }

        return true;
    }

    /**
     * Resolve a room alias to a room ID.
     *
     * @param string $alias Full alias e.g. #moodle-l3:server
     * @return string|null  Room ID or null if not found
     */
    public function resolve_alias(string $alias): ?string {
        $result = $this->request('GET',
            '/_matrix/client/v3/directory/room/' . rawurlencode($alias)
        );

        return $result['room_id'] ?? null;
    }

    /**
     * Generate a short-lived Matrix access token for a given user.
     *
     * Uses the Synapse Admin API:
     *   POST /_synapse/admin/v1/users/{userId}/login
     *
     * The token lifetime is read from the plugin config (default: 28800 s = 8 h).
     * Note: Synapse cannot generate a token for the admin account itself — this
     * method returns null in that case, which the caller must handle gracefully.
     *
     * A stable device_id is derived from the user ID so the Matrix JS SDK can
     * upload E2EE device keys without a "must pass device_id" 400 error.
     * Formula: first 8 alphanumeric chars of the user ID, uppercased.
     *
     * @param string $matrix_user_id  Full Matrix user ID, e.g. @john:server
     * @param int    $valid_seconds   Token lifetime in seconds (0 = use plugin config)
     * @return string|null            Access token or null on failure
     */
    public function get_user_login_token(string $matrix_user_id, int $valid_seconds = 0): ?string {
        if ($valid_seconds <= 0) {
            $valid_seconds = (int) get_config('mod_matrix', 'token_lifetime') ?: 28800;
        }

        $valid_until_ms = (time() + $valid_seconds) * 1000;

        // Stable device_id: same formula used by the JS client side.
        // userId.replace(/[^A-Z0-9]/gi,"").substring(0,8).toUpperCase()
        $tag       = strtoupper(preg_replace('/[^A-Z0-9]/i', '', $matrix_user_id));
        $tag       = substr($tag, 0, 8);
        $device_id = 'MOODLE_' . $tag;

        $result = $this->request(
            'POST',
            '/_synapse/admin/v1/users/' . rawurlencode($matrix_user_id) . '/login',
            ['valid_until_ms' => $valid_until_ms, 'device_id' => $device_id]
        );

        return $result['access_token'] ?? null;
    }

    /**
     * Ensure a Matrix account exists for the given user ID.
     * Uses the Synapse admin API to create the account if missing.
     *
     * @param string $matrix_user_id  e.g. @john:server
     * @param string $display_name    e.g. "John Doe"
     * @return bool
     */
    public function ensure_user_exists(string $matrix_user_id, string $display_name = ''): bool {
        $check = $this->request('GET',
            '/_synapse/admin/v2/users/' . rawurlencode($matrix_user_id)
        );

        if (isset($check['name'])) {
            return true; // User already exists.
        }

        $body = [
            'displayname' => $display_name ?: $matrix_user_id,
            'password'    => bin2hex(random_bytes(16)), // Random — login is via token only.
            'admin'       => false,
            'deactivated' => false,
        ];

        $result = $this->request('PUT',
            '/_synapse/admin/v2/users/' . rawurlencode($matrix_user_id),
            $body
        );

        return isset($result['name']) || !isset($result['errcode']);
    }

    /**
     * Get room members.
     *
     * @param string $room_id
     * @return array  List of user_ids currently joined to the room
     */
    public function get_room_members(string $room_id): array {
        $result = $this->request('GET',
            '/_matrix/client/v3/rooms/' . rawurlencode($room_id) . '/members'
        );

        if (empty($result['chunk'])) {
            return [];
        }

        $members = [];
        foreach ($result['chunk'] as $event) {
            if (($event['type'] ?? '') === 'm.room.member' &&
                ($event['content']['membership'] ?? '') === 'join') {
                $members[] = $event['state_key'];
            }
        }

        return $members;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Perform an HTTP request against the Matrix homeserver.
     *
     * Uses native PHP cURL to avoid any dependency on Moodle's \curl class
     * (which requires lib/filelib.php to be loaded first).
     *
     * SSL verification and timeout are read from the plugin configuration so
     * administrators can adapt them per-deployment without touching code.
     *
     * @param string     $method  GET | POST | PUT
     * @param string     $path    API path starting with /
     * @param array|null $body    Request body (will be JSON-encoded)
     * @return array     Decoded JSON response (may contain 'errcode' on failure)
     */
    private function request(string $method, string $path, ?array $body = null): array {
        if (!function_exists('curl_init')) {
            return [
                'errcode' => 'M_NO_CURL',
                'error'   => 'The PHP cURL extension is not installed on this server.',
            ];
        }

        $url  = $this->homeserver_url . $path;
        $json = json_encode($body ?? new \stdClass());

        $headers = [
            'Authorization: Bearer ' . $this->token,
            'Content-Type: application/json',
            'Accept: application/json',
        ];

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => min(5, $this->timeout),
            CURLOPT_SSL_VERIFYPEER => $this->ssl_verify,
            CURLOPT_SSL_VERIFYHOST => $this->ssl_verify ? 2 : 0,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_USERAGENT      => 'Moodle-mod_matrix/1.1',
        ]);

        switch ($method) {
            case 'GET':
                break;

            case 'POST':
                curl_setopt($ch, CURLOPT_POST, true);
                curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
                break;

            case 'PUT':
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PUT');
                curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
                break;

            default:
                curl_close($ch);
                return ['errcode' => 'INVALID_METHOD', 'error' => 'Unsupported HTTP method: ' . $method];
        }

        $response   = curl_exec($ch);
        $http_code  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curl_error = curl_error($ch);
        curl_close($ch);

        if ($response === false || $http_code === 0) {
            return [
                'errcode' => 'M_UNREACHABLE',
                'error'   => 'Could not connect to homeserver: ' . ($curl_error ?: 'unknown cURL error'),
            ];
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            return [
                'errcode' => 'M_INVALID_JSON',
                'error'   => 'Invalid JSON response from homeserver (HTTP ' . $http_code . ')',
            ];
        }

        return $decoded;
    }
}
