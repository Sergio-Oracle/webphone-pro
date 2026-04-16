<?php
/**
 * Privacy provider for mod_matrix (GDPR compliance)
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_matrix\privacy;

defined('MOODLE_INTERNAL') || die();

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\userlist;
use core_privacy\local\request\writer;

class provider implements
    \core_privacy\local\metadata\provider,
    \core_privacy\local\request\plugin\provider,
    \core_privacy\local\request\core_userlist_provider {

    public static function get_metadata(collection $collection): collection {

        $collection->add_database_table(
            'matrix',
            [
                'room_id'    => 'privacy:metadata:matrix_rooms:room_id',
                'room_alias' => 'privacy:metadata:matrix_rooms:room_alias',
            ],
            'privacy:metadata:matrix_rooms'
        );

        $collection->add_external_location_link(
            'matrix_homeserver',
            ['user_id' => 'privacy:metadata:external_matrix'],
            'privacy:metadata:external_matrix'
        );

        return $collection;
    }

    public static function get_contexts_for_userid(int $userid): contextlist {
        // mod_matrix does not store personal data per-user in its own tables.
        return new contextlist();
    }

    public static function get_users_in_context(userlist $userlist): void {
        // No per-user data stored.
    }

    public static function export_user_data(approved_contextlist $contextlist): void {
        // No per-user data to export.
    }

    public static function delete_data_for_all_users_in_context(\context $context): void {
        // No per-user data to delete.
    }

    public static function delete_data_for_user(approved_contextlist $contextlist): void {
        // No per-user data to delete.
    }

    public static function delete_data_for_users(approved_userlist $userlist): void {
        // No per-user data to delete.
    }
}
