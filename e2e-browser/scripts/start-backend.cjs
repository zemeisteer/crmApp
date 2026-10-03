// Playwright's webServer for the API: a fresh test database, migrated with
// the one migration command everything uses, then the backend's production
// build (backend/dist) on it.
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const { BACKEND, db, backendEnv, backendRequire } = require('./env.cjs');

(async () => {
  const { Client } = backendRequire('pg');
  const admin = new Client({ connectionString: db.adminUrl });
  await admin.connect();
  const quoted = `"${db.name.replace(/"/g, '""')}"`;
  const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db.name])).rowCount > 0;
  if (exists && db.disposable) await admin.query(`DROP DATABASE ${quoted} WITH (FORCE)`);
  if (!exists || db.disposable) await admin.query(`CREATE DATABASE ${quoted}`);
  await admin.end();
  execFileSync('node', ['scripts/migrate.cjs'], { cwd: BACKEND, env: backendEnv, stdio: ['ignore', 'inherit', 'inherit'] });
  const server = spawn('node', [path.join(BACKEND, 'dist', 'main.js')], { cwd: BACKEND, env: backendEnv, stdio: 'inherit' });
  const stop = () => server.kill();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  server.on('exit', (code) => process.exit(code ?? 0));
})().catch((err) => {
  console.error(`browser tests: could not prepare the API: ${err.message}`);
  process.exit(1);
});
