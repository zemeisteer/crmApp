// Applies every drizzle/NNNN_*.sql that has not run yet, in order, each in
// its own transaction, and records it in app_migrations. Runs on container
// start (see Dockerfile), so a deploy brings the schema up to date by itself.
//
//   node scripts/migrate.cjs              apply pending migrations
//   node scripts/migrate.cjs --status     list applied / pending
//   node scripts/migrate.cjs --baseline   mark all current files as applied
//                                         without running them (a database
//                                         built earlier with db:push)
//
// A database that already has tables but no app_migrations is not touched
// unless --baseline is given: old files would otherwise be replayed.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'drizzle');

function migrationFiles() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort();
}

function statementsOf(file) {
  return fs
    .readFileSync(path.join(DIR, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // One runner at a time (several containers starting together).
    await client.query('SELECT pg_advisory_lock(727274)');

    const { rows: t } = await client.query("SELECT to_regclass('public.app_migrations') AS m, to_regclass('public.tenants') AS t");
    const hasJournal = Boolean(t[0].m);
    const hasSchema = Boolean(t[0].t);
    const files = migrationFiles();

    if (!hasJournal) {
      if (hasSchema && !args.has('--baseline')) {
        console.error(
          'migrate: the database already has tables but no app_migrations.\n' +
            'If its schema is up to date (built with db:push / db:apply-sql), run once:\n' +
            '  node scripts/migrate.cjs --baseline',
        );
        process.exit(1);
      }
      await client.query('CREATE TABLE IF NOT EXISTS app_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    }

    if (args.has('--baseline')) {
      for (const f of files) await client.query('INSERT INTO app_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
      console.log(`migrate: marked ${files.length} migration(s) as applied`);
      return;
    }

    const { rows } = await client.query('SELECT tag FROM app_migrations');
    const done = new Set(rows.map((r) => r.tag));
    const pending = files.filter((f) => !done.has(f));

    if (args.has('--status')) {
      for (const f of files) console.log(`${done.has(f) ? 'applied' : 'PENDING'}  ${f}`);
      return;
    }
    if (pending.length === 0) {
      console.log('migrate: database is up to date');
      return;
    }
    for (const f of pending) {
      const stmts = statementsOf(f);
      await client.query('BEGIN');
      try {
        for (const s of stmts) await client.query(s);
        await client.query('INSERT INTO app_migrations (tag) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log(`migrate: applied ${f} (${stmts.length} statements)`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${f}: ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('migrate failed:', err.message);
  process.exit(1);
});
