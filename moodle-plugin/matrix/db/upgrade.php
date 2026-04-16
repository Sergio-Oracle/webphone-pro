<?php
/**
 * Upgrade steps for mod_matrix
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

function xmldb_matrix_upgrade($oldversion) {
    global $DB;
    $dbman = $DB->get_manager();

    // Future upgrade steps go here.
    // Example:
    // if ($oldversion < 2026050100) {
    //     $table = new xmldb_table('matrix');
    //     $field = new xmldb_field('newfield', XMLDB_TYPE_TEXT, null, null, null, null, null, 'timemodified');
    //     if (!$dbman->field_exists($table, $field)) {
    //         $dbman->add_field($table, $field);
    //     }
    //     upgrade_mod_savepoint(true, 2026050100, 'matrix');
    // }

    return true;
}
