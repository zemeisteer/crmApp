// Applies one hand-written, idempotent SQL migration (drizzle/NNNN_*.sql)
// inside a single transaction. Intended for databases that were created with
// `db:push` and therefore have no drizzle migration journal table, where
// `drizzle-kit migrate` would try to replay the 0000 baseline.
//
//   node scripts/apply-sql-migration.cjs drizzle/0003_admissions_crm.sql
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/apply-sql-migration.cjs <path-to-sql>');
    process.exit(1);
  }
  const sqlText = fs.readFileSync(path.resolve(file), 'utf8');
  const statements = sqlText
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const stmt of statements) await client.query(stmt);
    await client.query('COMMIT');
    console.log(`Applied ${path.basename(file)} (${statements.length} statements)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Migration failed, rolled back: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
