// Read-only report: attendance marks that are not bound to a lesson
// (attendance.schedule_id IS NULL) although their group has timetable rows.
//
// Migration 0053 binds an old mark to a lesson only when exactly one live
// timetable row of its group gives a lesson on that date. The rest are left
// as day-level marks on purpose - never copied to every lesson of the day,
// never put on the first one. This lists them per center, group and day,
// with the reason. The same list is shown to a center's admins
// (GET /api/attendance/unbound, the attendance page). A mark is bound when
// someone marks that student for a named lesson of that day.
//
//   npm run db:report-attendance-links            (uses DATABASE_URL)
//
// Changes nothing. Exit code 0 also when rows are listed.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const totals = (await client.query(`
      SELECT count(*)::int AS marks,
             count(*) FILTER (WHERE schedule_id IS NOT NULL)::int AS bound,
             count(*) FILTER (WHERE schedule_id IS NULL AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.group_id = a.group_id))::int AS no_timetable,
             count(*) FILTER (WHERE schedule_id IS NULL AND EXISTS (SELECT 1 FROM schedules s WHERE s.group_id = a.group_id))::int AS unbound
      FROM attendance a`)).rows[0];
    console.log(`Attendance marks: ${totals.marks}; bound to a lesson: ${totals.bound}; day-level in groups without timetable rows: ${totals.no_timetable}; NOT bound although the group has a timetable: ${totals.unbound}`);
    const { rows } = await client.query(`
      SELECT a.tenant_id, a.group_id, g.name AS group_name, a.date, count(*)::int AS marks,
        (SELECT count(*)::int FROM schedules s WHERE s.group_id = a.group_id AND s.status <> 'CANCELLED'
           AND ((s.date IS NULL AND s.day_of_week = extract(isodow FROM (CASE WHEN a.date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN a.date END)::date)::int) OR s.date = a.date)) AS lessons
      FROM attendance a JOIN groups g ON g.id = a.group_id
      WHERE a.schedule_id IS NULL AND EXISTS (SELECT 1 FROM schedules s WHERE s.group_id = a.group_id)
      GROUP BY a.tenant_id, a.group_id, g.name, a.date
      ORDER BY a.tenant_id, a.date DESC, g.name
      LIMIT 2000`);
    const several = rows.filter((r) => r.lessons > 1);
    const none = rows.filter((r) => r.lessons === 0);
    console.log(`Days with marks not bound: ${rows.length} (several lessons that day: ${several.length}; no timetable lesson that day: ${none.length}${rows.length === 2000 ? '; list cut at 2000' : ''})`);
    for (const r of rows) {
      console.log(`- center ${r.tenant_id} | group "${r.group_name}" (${r.group_id}) | ${r.date} | ${r.marks} mark(s) | ${r.lessons > 1 ? `${r.lessons} lessons that day: not clear which was meant` : r.lessons === 1 ? 'one lesson fits: bound the next time the migration statement runs' : 'no timetable lesson that day'}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
