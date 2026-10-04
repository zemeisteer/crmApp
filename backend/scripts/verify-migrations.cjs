// Proves the migration chain on scratch databases (created next to
// DATABASE_URL, names end in "_migcheck", dropped afterwards). Everything
// goes through the one supported command, `npm run db:migrate`
// (scripts/migrate.cjs):
//
//   1. empty database -> latest; schema matches schema.ts; re-run is a no-op
//   2. a database at an early baseline with rows -> latest, rows untouched
//   3. enum values: a database whose enum type is already committed gets the
//      migration that adds a value and the later one that uses it - which
//      PostgreSQL refuses inside a single transaction
//   4. a database at 0031 with representative records -> 0032, 0033:
//      who gets a membership, who does not, where price history comes from
//   5. a database that drizzle-kit migrated in the past is adopted
//   6. a database with tables but no record is refused until --baseline
//   7. a database at 0034 with payroll rows the old code wrote -> 0035:
//      rows untouched, nothing linked, installments allowed
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
// The canonical command itself, so a change of what `db:migrate` runs is
// tested here too.
const runner = (url, ...args) => run(url, 'npm', ['run', '-s', 'db:migrate', ...(args.length ? ['--', ...args] : [])]);
const fs = require('fs');
const crypto = require('crypto');
const JOURNAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8')).entries;
const statementsOf = (tag) =>
  fs.readFileSync(path.join(ROOT, 'drizzle', `${tag}.sql`), 'utf8').split('--> statement-breakpoint').map((x) => x.trim()).filter((x) => x.replace(/--.*$/gm, '').trim());
const query = async (url, sql, params) => {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
};
// Every row of every table, to prove a re-run changes nothing.
const dump = async (url) => {
  const tables = (await query(url, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'app_migrations' ORDER BY 1")).map((r) => r.table_name);
  const out = {};
  for (const t of tables) out[t] = JSON.stringify((await query(url, `SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`)).map((r) => JSON.parse(r.j)));
  return out;
};
const drift = (url) => run(url, 'npx', ['tsx', 'scripts/check-schema-drift.ts']);
const expect = (cond, what) => {
  if (!cond) throw new Error(`FAILED: ${what}`);
  console.log(`  ok  ${what}`);
};

// Rows a pilot database would already hold.
const SEED = `
  INSERT INTO tenants (id, name, subdomain) VALUES ('t_keep', 'Keep Center', 'keep-center');
  INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ('u_keep', 't_keep', 'keep@test.uz', 'x', 'Keep Owner', 'OWNER');
  INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ('u_gone', 't_keep', 'gone@test.uz', 'x', 'Removed Admin', 'ADMIN');
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
  expect(/applied 0021_/.test(out) && /applied 0027_/.test(out) && /applied 0031_/.test(out), 'every pending migration (0021 onwards) is applied');
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
  // Backfills only add: the group's price history starts from its one known price.
  const c3 = new Client({ connectionString: up });
  await c3.connect();
  const hist = (await c3.query("SELECT monthly_price FROM group_price_history WHERE group_id = 'g_keep'")).rows;
  const pay = (await c3.query("SELECT idempotency_key FROM payments WHERE id = 'p_keep'")).rows[0];
  await c3.end();
  expect(hist.length === 1 && hist[0].monthly_price === 450000, 'the existing group gets one price-history row at its current price');
  const c4 = new Client({ connectionString: up });
  await c4.connect();
  const src = (await c4.query("SELECT source FROM group_price_history WHERE group_id = 'g_keep'")).rows[0].source;
  const members = (await c4.query("SELECT user_id, role, status FROM organization_memberships WHERE tenant_id = 't_keep' ORDER BY user_id")).rows;
  await c4.end();
  expect(src === 'ASSUMED', 'that row is labelled as an assumption, not a recorded price');
  expect(members.length === 1 && members[0].user_id === 'u_keep' && members[0].role === 'OWNER' && members[0].status === 'ACTIVE', 'the founder (OWNER with no membership) gets a membership');
  expect(!members.some((m) => m.user_id === 'u_gone'), 'an ambiguous account without a membership is not given access');
  expect(pay.idempotency_key === null, 'existing payments stay as they were (no retry key)');
  expect(/No schema drift/.test(drift(up)), 'upgraded schema matches schema.ts');
  expect(/up to date/.test(runner(up)), 're-running after the upgrade changes nothing');

  console.log('3. an enum value added by one migration and used by a later one');
  const en = await recreate('enum');
  // 0000-0001 committed: the "role" type exists, as in every real database.
  runner(en, '--through', '0001_invoices_and_payment_gateways');
  // What a single transaction over the rest does (how drizzle-kit migrate
  // works): PostgreSQL refuses to use 'OWNER' before it is committed.
  let refusedInOneTx = '';
  {
    const c1 = new Client({ connectionString: en });
    await c1.connect();
    await c1.query('BEGIN');
    try {
      for (const e of JOURNAL.slice(2)) for (const st of statementsOf(e.tag)) await c1.query(st).catch((err) => { throw Object.assign(err, { tag: e.tag }); });
    } catch (err) {
      refusedInOneTx = `${err.tag}: ${err.code} ${err.message}`;
    }
    await c1.query('ROLLBACK');
    await c1.end();
  }
  expect(/^0032_membership_tombstones: 55P04 unsafe use of new value "OWNER"/.test(refusedInOneTx), `one transaction for all of them fails (${refusedInOneTx || 'it did not'})`);
  const enOut = runner(en);
  expect(/applied 0002_/.test(enOut) && /applied 0032_/.test(enOut) && /applied 0033_/.test(enOut), 'db:migrate commits each migration, so 0002 adds the value and 0032 uses it');
  expect(/No schema drift/.test(drift(en)), 'and the result matches schema.ts');

  console.log('4. upgrade from 0031 with representative records');
  const v31 = await recreate('v31');
  runner(v31, '--through', '0031_ai_usage_import_queue');
  await query(v31, `
    INSERT INTO tenants (id, name, subdomain) VALUES
      ('tA', 'Founder Center', 'founder-center'), ('tB', 'Owned Center', 'owned-center'), ('tC', 'Two Owners', 'two-owners');
    INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES
      ('uA_owner',   'tA', 'a-owner@test.uz',   'x', 'Founder',            'OWNER'),
      ('uA_removed', 'tA', 'a-removed@test.uz', 'x', 'Removed Admin',      'ADMIN'),
      ('uA_susp',    'tA', 'a-susp@test.uz',    'x', 'Suspended Manager',  'MANAGER'),
      ('uA_teacher', 'tA', 'a-teacher@test.uz', 'x', 'Active Teacher',     'TEACHER'),
      ('uB_owner',   'tB', 'b-owner@test.uz',   'x', 'Owner With Member',  'OWNER'),
      ('uB_other',   'tB', 'b-other@test.uz',   'x', 'Owner Row, No Member', 'OWNER'),
      ('uC_one',     'tC', 'c-one@test.uz',     'x', 'One Of Two',         'OWNER'),
      ('uC_two',     'tC', 'c-two@test.uz',     'x', 'Two Of Two',         'OWNER');
    INSERT INTO organization_memberships (id, user_id, tenant_id, role, status) VALUES
      ('mA_susp', 'uA_susp', 'tA', 'MANAGER', 'SUSPENDED'),
      ('mA_teacher', 'uA_teacher', 'tA', 'TEACHER', 'ACTIVE'),
      ('mB_owner', 'uB_owner', 'tB', 'OWNER', 'ACTIVE');
    INSERT INTO groups (id, tenant_id, name, subject, monthly_price, created_at) VALUES ('gA', 'tA', 'Group A', 'Math', 600000, '2026-01-10 05:00:00');
    -- What 0030 wrote for an existing group, and a price change made in the app afterwards.
    INSERT INTO group_price_history (id, tenant_id, group_id, monthly_price, effective_from, created_at) VALUES
      ('gph_gA', 'tA', 'gA', 400000, '2026-01-10 05:00:00', '2026-09-20 05:00:00'),
      ('chg_gA_1', 'tA', 'gA', 600000, '2026-09-25 05:00:00', '2026-09-25 05:00:00');
    INSERT INTO students (id, tenant_id, full_name) VALUES ('sA', 'tA', 'Student A');
    INSERT INTO enrollments (id, student_id, group_id) VALUES ('eA', 'sA', 'gA');
    INSERT INTO invoices (id, tenant_id, student_id, enrollment_id, amount, amount_paid, remaining_amount, due_date, for_month, status) VALUES ('iA', 'tA', 'sA', 'eA', 400000, 150000, 250000, '2026-09-10 05:00:00', '2026-09', 'PARTIALLY_PAID');
    INSERT INTO payments (id, tenant_id, student_id, invoice_id, amount, for_month, status, method, idempotency_key) VALUES ('pA', 'tA', 'sA', 'iA', 150000, '2026-09', 'PAID', 'CASH', 'key-0001-abcdef');
    INSERT INTO payment_allocations (id, tenant_id, payment_id, invoice_id, amount) VALUES ('alA', 'tA', 'pA', 'iA', 150000);
    INSERT INTO sessions (id, user_id, tenant_id, refresh_token_hash) VALUES ('sessA', 'uA_removed', 'tA', 'hash-a');
  `);
  const before31 = await dump(v31);
  const out31 = runner(v31);
  expect(/applied 0032_/.test(out31) && /applied 0033_/.test(out31) && !/applied 0031_/.test(out31), 'only 0032 and 0033 are applied');
  const after31 = await dump(v31);
  for (const t of ['tenants', 'users', 'groups', 'students', 'enrollments', 'invoices', 'payments', 'payment_allocations', 'sessions']) {
    const was = JSON.parse(before31[t]);
    const now = JSON.parse(after31[t]);
    expect(was.length === now.length && was.every((r, n) => Object.keys(r).every((k) => JSON.stringify(r[k]) === JSON.stringify(now[n][k]))), `${t}: ${was.length} row(s) unchanged`);
  }
  const m = await query(v31, 'SELECT id, user_id, tenant_id, role, status, removed_at FROM organization_memberships ORDER BY user_id');
  const of = (u) => m.filter((r) => r.user_id === u);
  expect(of('uA_owner').length === 1 && of('uA_owner')[0].role === 'OWNER' && of('uA_owner')[0].status === 'ACTIVE' && of('uA_owner')[0].tenant_id === 'tA', 'founder: the only OWNER of a center with no OWNER membership gets one');
  expect(of('uA_removed').length === 0, 'a staff account without a membership (removed, or never linked) gets nothing');
  expect(of('uA_susp').length === 1 && of('uA_susp')[0].status === 'SUSPENDED' && of('uA_susp')[0].removed_at === null, 'a suspended membership stays suspended');
  expect(of('uA_teacher').length === 1 && of('uA_teacher')[0].status === 'ACTIVE', 'an active membership is untouched');
  expect(of('uB_other').length === 0 && of('uB_owner').length === 1, 'a center that already has an OWNER membership: no second owner is created');
  expect(of('uC_one').length === 0 && of('uC_two').length === 0, 'two candidate owners: ambiguous, neither is given access');
  expect(m.length === 4, 'exactly one membership was added in the whole database');
  const ph = await query(v31, "SELECT id, monthly_price, source, effective_from::text AS ef, confirmed_by_user_id FROM group_price_history ORDER BY id");
  const seed = ph.find((r) => r.id === 'gph_gA');
  const change = ph.find((r) => r.id === 'chg_gA_1');
  expect(seed.source === 'ASSUMED' && seed.monthly_price === 400000 && seed.ef.startsWith('2026-01-10'), 'the row 0030 seeded is labelled ASSUMED; its price and dates are as they were');
  expect(change.source === 'RECORDED' && change.monthly_price === 600000 && change.ef.startsWith('2026-09-25') && change.confirmed_by_user_id === null, 'a price change recorded in the app stays RECORDED, unchanged');
  expect(/No schema drift/.test(drift(v31)), 'upgraded schema matches schema.ts');
  expect(/up to date/.test(runner(v31)), 're-running reports nothing to do');
  const again31 = await dump(v31);
  expect(Object.keys(after31).every((t) => after31[t] === again31[t]), 're-running changes no row in any table');

  console.log('5. database that drizzle-kit migrated in the past');
  const dk = await recreate('drizzle');
  // The schema as of 0031 with drizzle-kit's own record of it (and none of ours).
  runner(dk, '--through', '0031_ai_usage_import_queue');
  await query(dk, 'DROP TABLE app_migrations; CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)');
  for (const e of JOURNAL.filter((x) => x.idx <= 31)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'drizzle', `${e.tag}.sql`))).digest('hex');
    await query(dk, 'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [hash, e.when]);
  }
  const adopted = runner(dk);
  expect(/adopted 32 migration/.test(adopted), 'what drizzle-kit recorded (0000-0031) is adopted, not re-applied');
  expect(/applied 0032_/.test(adopted) && /applied 0033_/.test(adopted) && !/applied 00[0-2]\d_|applied 003[01]_/.test(adopted), 'only the migrations after it are applied');
  expect(/No schema drift/.test(drift(dk)), 'and the schema matches schema.ts');
  expect(/up to date/.test(runner(dk)), 're-running changes nothing');

  console.log('6. database with tables but no record is refused');
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

  console.log('7. upgrade from 0034 with payroll records written by the old code');
  const v34 = await recreate('v34');
  runner(v34, '--through', '0034_create_idempotency');
  // One row per teacher and month, overwritten by each payout, and the
  // SALARY expenses each payout added beside it (no link between them).
  await query(v34, `
    INSERT INTO tenants (id, name, subdomain) VALUES ('tP', 'Payroll Center', 'payroll-center');
    INSERT INTO teachers (id, tenant_id, full_name, salary_type, salary_value) VALUES ('tchP', 'tP', 'Old Teacher', 'FIXED', 1000000);
    INSERT INTO salary_payments (id, tenant_id, teacher_id, amount, for_month, paid_at) VALUES ('spP', 'tP', 'tchP', 300000, '2026-08', '2026-08-25 05:00:00');
    INSERT INTO expenses (id, tenant_id, title, category, amount, date) VALUES
      ('exP1', 'tP', 'O''qituvchi maoshi: Old Teacher (2026-08)', 'SALARY', 700000, '2026-08-10'),
      ('exP2', 'tP', 'O''qituvchi maoshi: Old Teacher (2026-08)', 'SALARY', 300000, '2026-08-25');
  `);
  const before34 = await dump(v34);
  const out34 = runner(v34);
  expect(/applied 0035_/.test(out34) && !/applied 0034_/.test(out34), '0035 is applied');
  const after34 = await dump(v34);
  for (const t of ['tenants', 'teachers', 'salary_payments', 'expenses']) {
    const was = JSON.parse(before34[t]);
    const now = JSON.parse(after34[t]);
    expect(was.length === now.length && was.every((r, n) => Object.keys(r).every((k) => JSON.stringify(r[k]) === JSON.stringify(now[n][k]))), `${t}: ${was.length} row(s) unchanged`);
  }
  const sp = (await query(v34, "SELECT expense_id, idempotency_key, payment_method FROM salary_payments WHERE id = 'spP'"))[0];
  expect(sp.expense_id === null && sp.idempotency_key === null && sp.payment_method === null, 'the old salary row is not linked to any expense: that is left to the reconciliation report');
  // A second payout for the same teacher and month is now possible.
  await query(v34, "INSERT INTO salary_payments (id, tenant_id, teacher_id, amount, for_month, expense_id) VALUES ('spP2', 'tP', 'tchP', 100000, '2026-08', 'exP2')");
  let twice = '';
  await query(v34, "INSERT INTO salary_payments (id, tenant_id, teacher_id, amount, for_month, expense_id) VALUES ('spP3', 'tP', 'tchP', 100000, '2026-08', 'exP2')").catch((e) => { twice = e.code; });
  expect(twice === '23505', 'installments per month are allowed; one expense still belongs to one payout');
  let removed = '';
  await query(v34, "DELETE FROM expenses WHERE id = 'exP2'").catch((e) => { removed = e.code; });
  expect(removed === '23503', "a payout's expense cannot be deleted from under it");
  expect(/No schema drift/.test(drift(v34)), 'upgraded schema matches schema.ts');
  expect(/up to date/.test(runner(v34)), 're-running reports nothing to do');

  for (const s of ['empty', 'upgrade', 'enum', 'v31', 'drizzle', 'v34']) await drop(s);
  console.log('Migration chain verified.');
})().catch(async (err) => {
  console.error(err.stderr ? String(err.stderr) : err.message);
  process.exit(1);
});
