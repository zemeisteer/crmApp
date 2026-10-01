// Applies every pending migration from drizzle/, in the order of
// drizzle/meta/_journal.json (the same list `drizzle-kit migrate` uses),
// each in its own transaction, and records it in app_migrations. Runs on
// container start (see Dockerfile), so a deploy brings the schema up to
// date by itself; drizzle-kit is a dev dependency and is not in the image.
//
//   node scripts/migrate.cjs                    apply pending migrations
//   node scripts/migrate.cjs --status           list applied / pending
//   node scripts/migrate.cjs --check            verify journal == SQL files (no database)
//   node scripts/migrate.cjs --through <tag>    apply only up to and including <tag>
//   node scripts/migrate.cjs --baseline [tag]   mark everything (or up to <tag>) as
//                                               applied without running it
//
// Reconciling a database that this runner has not seen before:
//   - migrated with `drizzle-kit migrate` (has drizzle.__drizzle_migrations):
//     adopted automatically - what Drizzle recorded is marked applied.
//   - built with `db:push` or by hand (tables, but no record at all): the
//     runner stops. Check it with `npm run db:check-drift`, then say which
//     migration it corresponds to with --baseline [tag]; the rest is applied
//     normally. Migrations from 0001 on are idempotent (IF NOT EXISTS), so a
//     baseline that is too early is safe; 0000 is not, so never baseline
//     before it on a database that has tables.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'drizzle');

// Ordered migrations: the journal is the single list, and it must match the
// SQL files exactly - a file missing from the journal would be skipped by
// drizzle-kit (that is how 0021-0027 once failed CI).
function migrations() {
  const journal = JSON.parse(fs.readFileSync(path.join(DIR, 'meta', '_journal.json'), 'utf8'));
  const entries = journal.entries.slice().sort((a, b) => a.idx - b.idx);
  const files = fs.readdirSync(DIR).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
  const tags = entries.map((e) => `${e.tag}.sql`);
  const problems = [];
  for (const f of files) if (!tags.includes(f)) problems.push(`${f} is not in meta/_journal.json`);
  for (const t of tags) if (!files.includes(t)) problems.push(`${t} is in the journal but the file is missing`);
  entries.forEach((e, i) => {
    if (e.idx !== i) problems.push(`journal idx ${e.idx} for ${e.tag} should be ${i}`);
    if (i > 0 && e.when <= entries[i - 1].when) problems.push(`journal "when" of ${e.tag} is not after ${entries[i - 1].tag}`);
    if (!e.tag.startsWith(String(i).padStart(4, '0') + '_')) problems.push(`${e.tag} should start with ${String(i).padStart(4, '0')}_`);
  });
  if (problems.length) throw new Error(`migration list is inconsistent:\n  - ${problems.join('\n  - ')}`);
  return entries.map((e) => ({ file: `${e.tag}.sql`, tag: e.tag, when: e.when }));
}

function statementsOf(file) {
  return fs
    .readFileSync(path.join(DIR, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);
}

function upTo(list, tag, flag) {
  if (!tag) return list;
  const name = tag.replace(/\.sql$/, '');
  const i = list.findIndex((m) => m.tag === name);
  if (i < 0) throw new Error(`${flag}: unknown migration "${tag}"`);
  return list.slice(0, i + 1);
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const valueOf = (f) => {
    const v = argv[argv.indexOf(f) + 1];
    return v && !v.startsWith('--') ? v : undefined;
  };
  const all = migrations();
  if (has('--check')) {
    console.log(`migrate: ${all.length} migrations, journal and files agree`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // One runner at a time (several containers starting together).
    await client.query('SELECT pg_advisory_lock(727274)');

    const { rows: t } = await client.query(
      "SELECT to_regclass('public.app_migrations') AS m, to_regclass('public.tenants') AS t, to_regclass('drizzle.__drizzle_migrations') AS d",
    );
    const createJournal = () =>
      client.query('CREATE TABLE IF NOT EXISTS app_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const mark = async (list) => {
      for (const m of list) await client.query('INSERT INTO app_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING', [m.file]);
    };

    if (has('--baseline')) {
      const list = upTo(all, valueOf('--baseline'), '--baseline');
      await createJournal();
      await mark(list);
      console.log(`migrate: marked ${list.length} migration(s) as applied (through ${list[list.length - 1].tag})`);
      return;
    }

    if (!t[0].m) {
      if (t[0].d) {
        // Migrated by drizzle-kit: adopt what it recorded (created_at is the
        // journal's "when" of each applied migration).
        const { rows } = await client.query('SELECT max(created_at)::bigint AS last FROM drizzle.__drizzle_migrations');
        const last = Number(rows[0].last ?? 0);
        const applied = all.filter((m) => m.when <= last);
        await createJournal();
        await mark(applied);
        console.log(`migrate: adopted ${applied.length} migration(s) already applied by drizzle-kit`);
      } else if (t[0].t) {
        console.error(
          'migrate: the database already has tables but no migration record.\n' +
            'Check it with `npm run db:check-drift`, then tell the runner where it stands:\n' +
            '  node scripts/migrate.cjs --baseline            (schema is fully up to date)\n' +
            '  node scripts/migrate.cjs --baseline <tag>      (it corresponds to that migration)\n' +
            'and run the runner again to apply the rest.',
        );
        process.exit(1);
      } else {
        await createJournal();
      }
    }

    const { rows } = await client.query('SELECT tag FROM app_migrations');
    const done = new Set(rows.map((r) => r.tag));

    if (has('--status')) {
      for (const m of all) console.log(`${done.has(m.file) ? 'applied' : 'PENDING'}  ${m.file}`);
      return;
    }
    const pending = upTo(all, valueOf('--through'), '--through').filter((m) => !done.has(m.file));
    if (pending.length === 0) {
      console.log('migrate: database is up to date');
      return;
    }
    for (const m of pending) {
      const stmts = statementsOf(m.file);
      await client.query('BEGIN');
      try {
        for (const s of stmts) await client.query(s);
        await client.query('INSERT INTO app_migrations (tag) VALUES ($1)', [m.file]);
        await client.query('COMMIT');
        console.log(`migrate: applied ${m.file} (${stmts.length} statements)`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${m.file}: ${err.message}`);
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
