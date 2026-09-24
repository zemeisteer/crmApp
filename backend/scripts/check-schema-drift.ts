// Fails (exit 1) when the database is missing anything src/db/schema.ts
// declares: tables, columns, NOT NULL constraints, indexes or enum values.
// CI runs it right after `db:migrate` on an empty database, so a schema
// change that ships without a versioned migration is caught immediately
// instead of surfacing on the first production deploy.
//
//   npx tsx scripts/check-schema-drift.ts
import 'dotenv/config';
import { Client } from 'pg';
import { generateDrizzleJson } from 'drizzle-kit/api';
import * as schema from '../src/db/schema';

interface Col { name: string; notNull: boolean }
interface Tbl { name: string; columns: Record<string, Col>; indexes: Record<string, { name: string }> }
interface Enm { name: string; values: string[] }

async function main() {
  const expected = generateDrizzleJson(schema) as unknown as { tables: Record<string, Tbl>; enums: Record<string, Enm> };
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const cols = await client.query<{ table_name: string; column_name: string; is_nullable: string }>(
    `select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'`,
  );
  const indexes = await client.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public'`);
  const enums = await client.query<{ typname: string; enumlabel: string }>(
    `select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid`,
  );
  await client.end();

  const colMap = new Map(cols.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.is_nullable === 'NO']));
  const tables = new Set(cols.rows.map((r) => r.table_name));
  const indexNames = new Set(indexes.rows.map((r) => r.indexname));
  const enumLabels = new Set(enums.rows.map((r) => `${r.typname}.${r.enumlabel}`));

  const problems: string[] = [];
  for (const t of Object.values(expected.tables)) {
    if (!tables.has(t.name)) {
      problems.push(`missing table ${t.name}`);
      continue;
    }
    for (const c of Object.values(t.columns)) {
      const key = `${t.name}.${c.name}`;
      if (!colMap.has(key)) problems.push(`missing column ${key}`);
      else if (c.notNull && !colMap.get(key)) problems.push(`column ${key} should be NOT NULL`);
    }
    for (const ix of Object.values(t.indexes)) {
      if (!indexNames.has(ix.name)) problems.push(`missing index ${ix.name}`);
    }
  }
  for (const e of Object.values(expected.enums)) {
    for (const v of e.values) if (!enumLabels.has(`${e.name}.${v}`)) problems.push(`missing enum value ${e.name}.${v}`);
  }

  if (problems.length > 0) {
    console.error(`Schema drift: the database lacks ${problems.length} item(s) declared in schema.ts.`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Add a versioned migration in drizzle/ for these changes.');
    process.exit(1);
  }
  console.log('No schema drift: the database matches schema.ts.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
