// Which database the end-to-end suites use, and the rules that keep them
// away from every other one. Plain CommonJS: the vitest config and the
// global setup both load it.
//
//   E2E_DATABASE_URL   the test database, if you want to name it yourself
//   (otherwise)        DATABASE_URL with "_e2e" added to the database name:
//                      postgresql://.../talimcrm  ->  .../talimcrm_e2e
//
// A database is accepted only if its name ends in "_e2e" or "_test". That
// one rule is what stops a run against a development or production
// database, however the variables are set.
const TEST_NAME = /(_e2e|_test)$/;

function nameOf(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

function resolveE2eDatabase(env = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error('E2E: refusing to run with NODE_ENV=production');
  }
  const explicit = (env.E2E_DATABASE_URL || '').trim();
  const base = (env.DATABASE_URL || '').trim();
  if (!explicit && !base) {
    throw new Error('E2E: set DATABASE_URL (a "_e2e" database is derived from it) or E2E_DATABASE_URL');
  }
  let url;
  if (explicit) {
    url = explicit;
  } else if (TEST_NAME.test(nameOf(base))) {
    url = base; // already a test database (CI: talimcrm_test)
  } else {
    const u = new URL(base);
    u.pathname = `/${encodeURIComponent(`${nameOf(base)}_e2e`)}`;
    url = u.toString();
  }
  const name = nameOf(url);
  if (!TEST_NAME.test(name)) {
    throw new Error(
      `E2E: refusing to use database "${name}": the name must end in "_e2e" or "_test". ` +
        'The suites create and change thousands of rows; point E2E_DATABASE_URL at a database made for them.',
    );
  }
  return {
    url,
    name,
    // Only a database this tooling derived or that is named "_e2e" is ever
    // dropped and rebuilt; a "_test" database (CI's) is used as it is.
    disposable: /_e2e$/.test(name),
    // Somewhere to connect while creating / dropping it.
    adminUrl: (() => {
      const u = new URL(url);
      u.pathname = '/postgres';
      return u.toString();
    })(),
  };
}

module.exports = { resolveE2eDatabase, nameOf, TEST_NAME };
