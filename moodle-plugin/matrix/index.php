<?php
/**
 * List all Matrix Chat instances in a course
 *
 * @package   mod_matrix
 * @copyright 2026 RTN
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/matrix/lib.php');

$id = required_param('id', PARAM_INT); // Course ID

$course = $DB->get_record('course', ['id' => $id], '*', MUST_EXIST);
require_login($course);
$context = context_course::instance($course->id);

$PAGE->set_url('/mod/matrix/index.php', ['id' => $id]);
$PAGE->set_title(format_string($course->shortname) . ': ' . get_string('modulenameplural', 'mod_matrix'));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->set_context($context);

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('modulenameplural', 'mod_matrix'));

if (!$instances = get_all_instances_in_course('matrix', $course)) {
    notice(get_string('thereareno', 'moodle', get_string('modulenameplural', 'mod_matrix')),
        new moodle_url('/course/view.php', ['id' => $course->id]));
    die;
}

$table = new html_table();
$table->attributes['class'] = 'generaltable mod_index';

if ($course->format === 'weeks') {
    $table->head  = [get_string('week'), get_string('name')];
    $table->align = ['center', 'left'];
} elseif ($course->format === 'topics') {
    $table->head  = [get_string('topic'), get_string('name')];
    $table->align = ['center', 'left'];
} else {
    $table->head  = [get_string('name')];
    $table->align = ['left'];
}

foreach ($instances as $instance) {
    if (!$instance->visible) {
        $link = html_writer::link(
            new moodle_url('/mod/matrix/view.php', ['id' => $instance->coursemodule]),
            format_string($instance->name, true),
            ['class' => 'dimmed']
        );
    } else {
        $link = html_writer::link(
            new moodle_url('/mod/matrix/view.php', ['id' => $instance->coursemodule]),
            format_string($instance->name, true)
        );
    }

    if ($course->format === 'weeks' || $course->format === 'topics') {
        $table->data[] = [$instance->section, $link];
    } else {
        $table->data[] = [$link];
    }
}

echo html_writer::table($table);
echo $OUTPUT->footer();
