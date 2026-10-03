// The frontend's production build for the browser tests: the same code,
// built with the test API address, into its own folder (.next-browser).
const { execFileSync } = require('child_process');
const path = require('path');
const { FRONTEND, API_PORT } = require('./env.cjs');

execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'build'], {
  cwd: FRONTEND,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/api`, NEXT_DIST_DIR: '.next-browser' },
});
console.log(`built ${path.join(FRONTEND, '.next-browser')}`);
