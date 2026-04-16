<?php
/**
 * Matrix activity viewed event
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_matrix\event;

defined('MOODLE_INTERNAL') || die();

class course_module_viewed extends \core\event\course_module_viewed {

    protected function init() {
        $this->data['objecttable'] = 'matrix';
        parent::init();
    }

    public static function get_objectid_mapping() {
        return ['db' => 'matrix', 'restore' => 'matrix'];
    }
}
