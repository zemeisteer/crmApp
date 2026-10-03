// Playwright's webServer for the pages: `next start` on the build made by
// build-frontend.cjs (production mode, not the development server).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { FRONTEND, WEB_PORT } = require('./env.cjs');

if (!fs.existsSync(path.join(FRONTEND, '.next-browser', 'BUILD_ID'))) {
  console.error('browser tests: run `npm run build:frontend` first (no build in frontend/.next-browser)');
  process.exit(1);
}
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'start', '-p', String(WEB_PORT)], {
  cwd: FRONTEND,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, NEXT_DIST_DIR: '.next-browser', NODE_ENV: 'production' },
});
const stop = () => server.kill();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));
