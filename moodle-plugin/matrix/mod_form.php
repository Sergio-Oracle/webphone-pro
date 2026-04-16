<?php
// This file is part of Moodle - http://moodle.org/

/**
 * Module form for mod_matrix
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

// Ensure lib.php is available so matrix_sanitize_alias() can be called in validation.
require_once($CFG->dirroot . '/mod/matrix/lib.php');
require_once($CFG->dirroot . '/course/moodleform_mod.php');

class mod_matrix_mod_form extends moodleform_mod {

    public function definition() {
        global $CFG, $COURSE;

        $mform = $this->_form;

        // ── General ──────────────────────────────────────────────────────────
        $mform->addElement('header', 'general', get_string('general', 'form'));

        $mform->addElement('text', 'name', get_string('activityname', 'mod_matrix'), ['size' => '64']);
        $mform->setType('name', PARAM_TEXT);
        $mform->addRule('name', null, 'required', null, 'client');
        $mform->addRule('name', get_string('maximumchars', '', 255), 'maxlength', 255, 'client');

        $this->standard_intro_elements();

        // ── Matrix room settings ─────────────────────────────────────────────
        $mform->addElement('header', 'matrixroomsettings', get_string('roomsettings', 'mod_matrix'));
        $mform->setExpanded('matrixroomsettings');

        $homeserver = get_config('mod_matrix', 'homeserver_domain') ?: get_string('homeserver_domain_placeholder', 'mod_matrix');

        $mform->addElement('text', 'room_alias',
            get_string('roomalias', 'mod_matrix'),
            ['size' => '40', 'placeholder' => 'moodle-cours-' . $COURSE->id]);
        $mform->setType('room_alias', PARAM_RAW_TRIMMED);
        $mform->addHelpButton('room_alias', 'roomalias', 'mod_matrix');
        $mform->addElement('static', 'room_alias_hint', '',
            get_string('roomalias_hint', 'mod_matrix', $homeserver));

        $mform->addElement('text', 'room_id',
            get_string('roomid', 'mod_matrix'), ['size' => '60']);
        $mform->setType('room_id', PARAM_RAW_TRIMMED);
        $mform->addHelpButton('room_id', 'roomid', 'mod_matrix');

        $mform->addElement('advcheckbox', 'autocreate_room',
            get_string('autocreateroom', 'mod_matrix'),
            get_string('autocreateroom_desc', 'mod_matrix'));
        $mform->setDefault('autocreate_room', 1);
        $mform->addHelpButton('autocreate_room', 'autocreateroom', 'mod_matrix');

        $mform->addElement('advcheckbox', 'autoinvite_users',
            get_string('autoinviteusers', 'mod_matrix'),
            get_string('autoinviteusers_desc', 'mod_matrix'));
        $mform->setDefault('autoinvite_users', 1);
        $mform->addHelpButton('autoinvite_users', 'autoinviteusers', 'mod_matrix');

        $display_options = [
            'iframe'    => get_string('displaymode_iframe',     'mod_matrix'),
            'newwindow' => get_string('displaymode_newwindow',  'mod_matrix'),
            'redirect'  => get_string('displaymode_redirect',   'mod_matrix'),
        ];
        $mform->addElement('select', 'display_mode',
            get_string('displaymode', 'mod_matrix'), $display_options);
        $mform->setDefault('display_mode', 'iframe');
        $mform->addHelpButton('display_mode', 'displaymode', 'mod_matrix');

        $mform->addElement('text', 'iframe_height',
            get_string('iframeheight', 'mod_matrix'), ['size' => '6']);
        $mform->setType('iframe_height', PARAM_INT);
        $mform->setDefault('iframe_height', 700);
        $mform->hideIf('iframe_height', 'display_mode', 'neq', 'iframe');

        // ── Standard elements ─────────────────────────────────────────────────
        $this->standard_coursemodule_elements();
        $this->add_action_buttons();
    }

    public function validation($data, $files) {
        $errors = parent::validation($data, $files);

        if (!empty($data['room_alias'])) {
            $sanitized = matrix_sanitize_alias($data['room_alias']);
            if ($sanitized !== strtolower(trim($data['room_alias'])) && $sanitized !== $data['room_alias']) {
                $errors['room_alias'] = get_string('roomalias_invalid', 'mod_matrix');
            }
        }

        if (!empty($data['iframe_height']) && (int)$data['iframe_height'] < 200) {
            $errors['iframe_height'] = get_string('iframeheight_min', 'mod_matrix');
        }

        return $errors;
    }
}
