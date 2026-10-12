// Read-only report: what is known about who was in which group, and when.
//
// Migration 0054 turned every enrollment row into at most one stay marked
// LEGACY (its start is the last joining the row knew). It invented nothing:
//  - an ended enrollment with no leaving time got NO stay (when it ended is
//    not known);
//  - earlier stays of a student who had come back were already overwritten
//    and are not reconstructed.
// Stays written since then are RECORDED. This counts both, and lists the
// enrollments that have no stay at all.
//
//   npm run db:report-membership            (uses DATABASE_URL)
//
// Changes nothing.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const s = (await client.query(`
      SELECT count(*)::int AS stays,
             count(*) FILTER (WHERE source = 'RECORDED')::int AS recorded,
             count(*) FILTER (WHERE source = 'LEGACY')::int AS legacy,
             count(*) FILTER (WHERE ended_at IS NULL)::int AS open,
             count(*) FILTER (WHERE source = 'LEGACY' AND ended_at IS NOT NULL)::int AS legacy_closed
      FROM enrollment_periods`)).rows[0];
    console.log(`Stays: ${s.stays} (recorded when they happened: ${s.recorded}; taken over from old rows, LEGACY: ${s.legacy}, of which closed: ${s.legacy_closed}); open now: ${s.open}`);
    const e = (await client.query(`
      SELECT count(*)::int AS enrollments,
             count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM enrollment_periods p WHERE p.student_id = e.student_id AND p.group_id = e.group_id))::int AS without
      FROM enrollments e`)).rows[0];
    console.log(`Enrollments: ${e.enrollments}; with no stay at all (ended, the time not known): ${e.without}`);
    const { rows } = await client.query(`
      SELECT e.id, e.student_id, e.group_id, g.name AS group_name, e.status, e.joined_at, e.left_at
      FROM enrollments e LEFT JOIN groups g ON g.id = e.group_id
      WHERE NOT EXISTS (SELECT 1 FROM enrollment_periods p WHERE p.student_id = e.student_id AND p.group_id = e.group_id)
      ORDER BY e.joined_at DESC LIMIT 500`);
    for (const r of rows) {
      console.log(`- enrollment ${r.id} | student ${r.student_id} | group "${r.group_name ?? '?'}" | ${r.status} | joined ${r.joined_at?.toISOString?.() ?? r.joined_at} | left ${r.left_at ? r.left_at.toISOString() : 'not recorded'}`);
    }
    const bad = (await client.query(`
      SELECT count(*)::int AS n FROM enrollment_periods a JOIN enrollment_periods b
        ON a.student_id = b.student_id AND a.group_id = b.group_id AND a.id < b.id
       AND a.started_at < coalesce(b.ended_at, 'infinity') AND b.started_at < coalesce(a.ended_at, 'infinity')`)).rows[0].n;
    console.log(`Overlapping stays of one student in one group: ${bad}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
