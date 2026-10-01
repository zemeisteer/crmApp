// Proves the migration chain on scratch databases (created next to
// DATABASE_URL, names end in "_migcheck", dropped afterwards):
//
//   1. empty database -> runner -> schema matches schema.ts; re-run is a no-op
//   2. upgrade: a database at an earlier baseline with real-looking rows ->
//      runner -> same rows, untouched, and the schema matches
//   3. a database migrated by `drizzle-kit migrate` is adopted by the runner
//
//   node scripts/verify-migrations.cjs            (DATABASE_URL = any admin-capable URL)
require('dotenv').config({ quiet: true });
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE = '0020_daily_digest'; // the last migration before the 0021-0027 gap
const base = new URL(process.env.DATABASE_URL);

const urlFor = (suffix) => {
  const u = new URL(base.toString());
  u.pathname = `/${base.pathname.slice(1)}_${suffix}_migcheck`;
  return u.toString();
};
async function admin(sql) {
  const c = new Client({ connectionString: base.toString() });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}
const recreate = async (suffix) => {
  const name = new URL(urlFor(suffix)).pathname.slice(1);
  await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin(`CREATE DATABASE "${name}"`);
  return urlFor(suffix);
};
const drop = (suffix) => admin(`DROP DATABASE IF EXISTS "${new URL(urlFor(suffix)).pathname.slice(1)}" WITH (FORCE)`);

const run = (url, cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const runner = (url, ...args) => run(url, 'node', ['scripts/migrate.cjs', ...args]);
const drift = (url) => run(url, 'npx', ['tsx', 'scripts/check-schema-drift.ts']);
const expect = (cond, what) => {
  if (!cond) throw new Error(`FAILED: ${what}`);
  console.log(`  ok  ${what}`);
};

// Rows a pilot database would already hold.
const SEED = `
  INSERT INTO tenants (id, name, subdomain) VALUES ('t_keep', 'Keep Center', 'keep-center');
  INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ('u_keep', 't_keep', 'keep@test.uz', 'x', 'Keep Owner', 'OWNER');
  INSERT INTO groups (id, tenant_id, name, subject, monthly_price) VALUES ('g_keep', 't_keep', 'Keep Group', 'Math', 450000);
  INSERT INTO students (id, tenant_id, full_name, phone) VALUES ('s_keep', 't_keep', 'Keep Student', '+998900000001');
  INSERT INTO enrollments (id, student_id, group_id) VALUES ('e_keep', 's_keep', 'g_keep');
  INSERT INTO payments (id, tenant_id, student_id, amount, discount, for_month, status, method) VALUES ('p_keep', 't_keep', 's_keep', 440000, 10000, '2026-09', 'PAID', 'CASH');
  INSERT INTO attendance (id, tenant_id, group_id, student_id, date, status) VALUES ('a_keep', 't_keep', 'g_keep', 's_keep', '2026-09-28', 'PRESENT');
  INSERT INTO announcements (id, tenant_id, title, content) VALUES ('n_keep', 't_keep', 'Keep news', 'Text');
`;
const TABLES = ['tenants', 'users', 'groups', 'students', 'enrollments', 'payments', 'attendance', 'announcements'];
async function rows(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const out = {};
    for (const t of TABLES) out[t] = (await c.query(`SELECT row_to_json(x) AS j FROM ${t} x ORDER BY id`)).rows.map((r) => JSON.stringify(r.j));
    return out;
  } finally {
    await c.end();
  }
}

(async () => {
  console.log(runner(base.toString(), '--check').trim());

  console.log('1. empty database');
  const empty = await recreate('empty');
  runner(empty);
  expect(/No schema drift/.test(drift(empty)), 'migrations build the schema schema.ts declares');
  expect(/up to date/.test(runner(empty)), 're-running the runner changes nothing');

  console.log(`2. upgrade from ${BASELINE} with existing rows`);
  const up = await recreate('upgrade');
  runner(up, '--through', BASELINE);
  const c = new Client({ connectionString: up });
  await c.connect();
  await c.query(SEED);
  await c.end();
  const before = await rows(up);
  const out = runner(up);
  expect(/applied 0021_/.test(out) && /applied 0027_/.test(out), 'pending migrations 0021-0027 are applied');
  const after = await rows(up);
  for (const t of TABLES) {
    // Old columns keep their values; new columns only add keys.
    const same = before[t].every((b, i) => {
      const was = JSON.parse(b);
      const now = JSON.parse(after[t][i] ?? '{}');
      return Object.keys(was).every((k) => JSON.stringify(was[k]) === JSON.stringify(now[k]));
    });
    expect(before[t].length === after[t].length && same, `${t}: ${before[t].length} existing row(s) unchanged`);
  }
  expect(/No schema drift/.test(drift(up)), 'upgraded schema matches schema.ts');
  expect(/up to date/.test(runner(up)), 're-running after the upgrade changes nothing');

  console.log('3. database migrated by drizzle-kit');
  const dk = await recreate('drizzle');
  run(dk, 'npx', ['drizzle-kit', 'migrate']);
  expect(/No schema drift/.test(drift(dk)), 'drizzle-kit migrate builds the same schema');
  const adopted = runner(dk);
  expect(/adopted \d+ migration/.test(adopted) && /up to date/.test(adopted), 'the runner adopts it without re-applying anything');

  console.log('4. database with tables but no record is refused');
  let refused = false;
  const c2 = new Client({ connectionString: dk });
  await c2.connect();
  await c2.query('DROP TABLE app_migrations; DROP SCHEMA drizzle CASCADE;');
  await c2.end();
  try {
    runner(dk);
  } catch (e) {
    refused = /no migration record/.test(String(e.stderr));
  }
  expect(refused, 'the runner stops and asks for --baseline');
  runner(dk, '--baseline', BASELINE);
  expect(/applied 0021_/.test(runner(dk)), `--baseline ${BASELINE} then applies the rest`);

  for (const s of ['empty', 'upgrade', 'drizzle']) await drop(s);
  console.log('Migration chain verified.');
})().catch(async (err) => {
  console.error(err.stderr ? String(err.stderr) : err.message);
  process.exit(1);
});
