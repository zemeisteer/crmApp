// Read-only report: open make-up bookings into a group lesson that are not
// bound to a lesson (makeup_bookings.target_schedule_id IS NULL).
//
// Migration 0051 binds an open booking to its lesson only when exactly one
// live timetable row of the target group is on that date at the booked
// start. The rest are left alone on purpose - never guessed into "some
// other lesson that day". This lists them with the reason, so that someone
// can look before the next change of that group's timetable releases them
// (the booking is cancelled and the credit is usable again).
//
//   npm run db:report-makeup-links            (uses DATABASE_URL)
//
// Changes nothing. Exit code 0 also when rows are listed.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT b.id, b.tenant_id, b.target_group_id, g.name AS group_name, g.timetable_managed, g.deleted_at, g.status AS group_status,
             b.date, b.start_time, b.end_time, b.student_id,
             (SELECT count(*)::int FROM schedules s
               WHERE s.group_id = b.target_group_id AND s.tenant_id = b.tenant_id AND s.status <> 'CANCELLED' AND s.start_time = b.start_time
                 AND ((s.date IS NULL AND s.day_of_week = extract(isodow FROM b.date::date)::int) OR s.date = b.date)) AS candidates,
             (SELECT count(*)::int FROM schedules s WHERE s.group_id = b.target_group_id AND s.date IS NULL) AS weekly_rows
      FROM makeup_bookings b
      LEFT JOIN groups g ON g.id = b.target_group_id
      WHERE b.mode = 'GROUP_LESSON' AND b.status = 'BOOKED' AND b.target_schedule_id IS NULL
      ORDER BY b.tenant_id, b.date, b.start_time`);
    const why = (r) => {
      if (r.deleted_at || ['COMPLETED', 'ARCHIVED'].includes(r.group_status)) return 'the group has no lessons any more (deleted, completed or archived)';
      if (r.candidates > 1) return `${r.candidates} lessons of the group at that start on that date: not clear which was meant`;
      if (r.candidates === 1) return 'one lesson matches: it is bound the next time the migration statement or a timetable change runs';
      if (!r.timetable_managed && r.weekly_rows === 0) return 'the group has no timetable rows (its lessons come from the group form): nothing to bind to, the booking holds by date and start';
      return 'no lesson of the group at that start on that date';
    };
    console.log(`Open make-up bookings not bound to a lesson: ${rows.length}`);
    for (const r of rows) {
      console.log(`- booking ${r.id} | center ${r.tenant_id} | group "${r.group_name ?? '?'}" (${r.target_group_id}) | ${r.date} ${r.start_time}-${r.end_time} | student ${r.student_id}\n    ${why(r)}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
