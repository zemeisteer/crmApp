import { execFileSync } from 'child_process';
import { join } from 'path';
import { Client } from 'pg';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveE2eDatabase } = require('./e2e-database.cjs') as {
  resolveE2eDatabase: (env?: NodeJS.ProcessEnv) => { url: string; name: string; disposable: boolean; adminUrl: string };
};

// Runs once before the end-to-end suites: a database of their own, built by
// the one migration command everything uses (`npm run db:migrate`, i.e.
// scripts/migrate.cjs).
//
//  - "<name>_e2e" databases are dropped and rebuilt on every run, so no run
//    sees another run's rows. Set E2E_KEEP_DB=1 to keep it (faster reruns).
//  - A "<name>_test" database (CI) is never dropped: it is created if
//    missing and migrated.
//  - Nothing else is ever touched: see the name rule in e2e-database.cjs.
export default async function setup() {
  const target = resolveE2eDatabase();
  const quoted = `"${target.name.replace(/"/g, '""')}"`;

  const admin = new Client({ connectionString: target.adminUrl });
  await admin.connect();
  try {
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [target.name])).rowCount! > 0;
    if (exists && target.disposable && process.env.E2E_KEEP_DB !== '1') {
      await admin.query(`DROP DATABASE ${quoted} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${quoted}`);
    } else if (!exists) {
      await admin.query(`CREATE DATABASE ${quoted}`);
    }
  } finally {
    await admin.end();
  }

  execFileSync('node', ['scripts/migrate.cjs'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: target.url },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  console.log(`E2E database: ${target.name} (${target.disposable && process.env.E2E_KEEP_DB !== '1' ? 'rebuilt' : 'kept'}, migrated)`);
}
