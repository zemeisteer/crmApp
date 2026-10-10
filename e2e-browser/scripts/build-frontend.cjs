// The frontend's production build for the browser tests: the same code,
// built with the test API address, into its own folder (.next-browser).
const { execFileSync } = require('child_process');
const path = require('path');
const { FRONTEND, API_PORT, DIST_DIR } = require('./env.cjs');

execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'build'], {
  cwd: FRONTEND,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  // A production build whatever the shell (or backend/.env, which env.cjs
  // loads) says: with NODE_ENV=development `next build` fails while
  // prerendering.
  env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/api`, NEXT_DIST_DIR: DIST_DIR },
});
console.log(`built ${path.join(FRONTEND, DIST_DIR)}`);
