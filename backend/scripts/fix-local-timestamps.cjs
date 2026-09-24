// One-off repair for databases whose server timezone was NOT UTC before the
// DB pool was pinned to `TimeZone=UTC` (see src/db/db.module.ts). In such a
// database, rows timestamped by defaultNow() hold local wall-clock time and
// read back shifted by the zone offset (e.g. +5 h for Asia/Tashkent).
//
// Only `created_at` columns are corrected: the app never writes them itself
// (except the admissions tables, which always used app timestamps and are
// skipped), so every such value came from defaultNow(). Columns the app
// sometimes writes (updated_at, paid_at, joined_at, ...) cannot be told apart
// per row and are left untouched.
//
// Dry run by default. Use --apply to write, inside one transaction.
//   node scripts/fix-local-timestamps.cjs --offset-minutes=300 --before=2026-09-24T17:00:00Z
//   node scripts/fix-local-timestamps.cjs --offset-minutes=300 --before=... --apply
// --before must be the moment the UTC-pinned build was deployed; rows created
// after it are already correct.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const SKIP = new Set(['leads', 'lead_activities', 'lead_trials', '__drizzle_migrations']);

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const offset = Number(arg('offset-minutes'));
  const before = arg('before');
  const apply = process.argv.includes('--apply');
  if (!Number.isInteger(offset) || offset === 0 || !before || Number.isNaN(Date.parse(before))) {
    console.error('Usage: --offset-minutes=<non-zero int> --before=<ISO instant> [--apply]');
    process.exit(1);
  }
  // `before` is a real instant; the stored (shifted) values are local wall time.
  const cutoffLocal = new Date(Date.parse(before) + offset * 60_000).toISOString().replace('Z', '');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows: tables } = await client.query(`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'created_at' and data_type = 'timestamp without time zone'
    order by table_name`);
  try {
    await client.query('BEGIN');
    let total = 0;
    for (const { table_name: t } of tables) {
      if (SKIP.has(t)) continue;
      const where = `created_at < $1::timestamp`;
      const { rows } = await client.query(`select count(*)::int n from "${t}" where ${where}`, [cutoffLocal]);
      if (rows[0].n === 0) continue;
      total += rows[0].n;
      console.log(`${t}: ${rows[0].n} row(s)`);
      if (apply) {
        await client.query(`update "${t}" set created_at = created_at - make_interval(mins => $2) where ${where}`, [cutoffLocal, offset]);
      }
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(`${apply ? 'Shifted' : 'Would shift'} ${total} row(s) by -${offset} min${apply ? '' : ' (dry run; add --apply)'}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Failed, rolled back: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
