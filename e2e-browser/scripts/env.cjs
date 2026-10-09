// Where the browser tests run: their own database, ports and secrets.
// Nothing here points at a development or production service, and every
// external provider (AI, e-mail, SMS, Telegram, Click, Payme, Google Calendar) is switched off.
const path = require('path');
const { randomBytes } = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');

// The backend's own rules for test databases: the name must end in _e2e or
// _test; an _e2e database is rebuilt for every run.
const { createRequire } = require('module');
const backendRequire = createRequire(path.join(BACKEND, 'package.json'));
backendRequire('dotenv').config({ path: path.join(BACKEND, '.env'), quiet: true });
const { resolveE2eDatabase } = require(path.join(BACKEND, 'test', 'e2e-database.cjs'));

function browserDatabase() {
  if (process.env.BROWSER_DATABASE_URL) return resolveE2eDatabase({ E2E_DATABASE_URL: process.env.BROWSER_DATABASE_URL });
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL (a "_browser_e2e" database is derived from it) or BROWSER_DATABASE_URL');
  const u = new URL(base);
  u.pathname = `/${decodeURIComponent(u.pathname.slice(1)).replace(/(_e2e|_test)$/, '')}_browser_e2e`;
  return resolveE2eDatabase({ E2E_DATABASE_URL: u.toString() });
}

const API_PORT = Number(process.env.BROWSER_API_PORT || 4300);
const WEB_PORT = Number(process.env.BROWSER_WEB_PORT || 3300);

const db = browserDatabase();
const backendEnv = {
  ...process.env,
  DATABASE_URL: db.url,
  PORT: String(API_PORT),
  // development: the CORS rules for http://localhost and *.localhost (the
  // production rules allow https only). Everything else is the production build.
  NODE_ENV: 'development',
  ROOT_DOMAIN: 'localhost',
  FRONTEND_URL: `http://localhost:${WEB_PORT}`,
  // The API is on its own port here (in production it is the site's /api):
  // calendar subscription links must point at it.
  PUBLIC_API_URL: `http://localhost:${API_PORT}/api`,
  JWT_SECRET: process.env.BROWSER_JWT_SECRET || randomBytes(32).toString('hex'),
  GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', RESEND_API_KEY: '', SMTP_HOST: '',
  TELEGRAM_BOT_TOKEN: '', TELEGRAM_POLLING: 'false', ESKIZ_API_TOKEN: '', PLAYMOBILE_API_TOKEN: '',
  CLICK_MERCHANT_ID: '', CLICK_SERVICE_ID: '', CLICK_SECRET_KEY: '', PAYME_MERCHANT_ID: '', PAYME_KEY: '',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '',
  SENTRY_DSN: '', REMINDER_SCAN_MS: '0', IMPORT_POLL_MS: '0', IMPORT_QUEUE: 'browser-tests',
};

module.exports = { ROOT, BACKEND, FRONTEND, db, API_PORT, WEB_PORT, backendEnv, backendRequire };
