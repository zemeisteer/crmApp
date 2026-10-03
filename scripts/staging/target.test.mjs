// Tests of the destination rules of verify-flows.mjs.
//   node --test scripts/staging/target.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TargetError, guardedFetch, looksLikeTestHost, parseArgs, resolveTarget } from './target.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, 'verify-flows.mjs');
const stg = (over = {}) => ({ api: 'https://staging.school.uz/api', root: 'staging.school.uz', confirm: 'staging.school.uz', ...over });
const rejects = (args, re) => assert.throws(() => resolveTarget(args), (e) => e instanceof TargetError && re.test(e.message), JSON.stringify(args));

test('normal staging: the API is the confirmed root domain over https', () => {
  const t = resolveTarget(stg());
  assert.equal(t.api, 'https://staging.school.uz/api');
  assert.equal(t.local, false);
  assert.equal(resolveTarget(stg({ api: 'https://staging.school.uz/api/' })).api, 'https://staging.school.uz/api');
  assert.equal(resolveTarget(stg({ api: 'HTTPS://Staging.School.UZ/api' })).api, 'https://staging.school.uz/api');
});

test('an API on another host than the confirmed root is refused', () => {
  // The case that got through before: a staging-looking --root, any --api.
  rejects(stg({ api: 'https://school.uz/api' }), /not the confirmed root domain/);
  rejects(stg({ api: 'https://api.school.uz/api' }), /not the confirmed root domain/);
  rejects(stg({ api: 'https://evil.example.com/api' }), /not the confirmed root domain/);
  rejects(stg({ api: 'https://staging.school.uz.evil.example.com/api' }), /not the confirmed root domain/);
  rejects(stg({ api: 'https://xstaging.school.uz/api' }), /not the confirmed root domain/);
  rejects(stg({ api: 'https://center.staging.school.uz/api' }), /not the confirmed root domain/);
});

test('a separate API host must be confirmed by its actual name, and look like a test host', () => {
  const t = resolveTarget(stg({ api: 'https://api-staging.school.uz/api', 'confirm-api-host': 'api-staging.school.uz' }));
  assert.equal(t.api, 'https://api-staging.school.uz/api');
  rejects(stg({ api: 'https://api-staging.school.uz/api', 'confirm-api-host': 'staging.school.uz' }), /not the confirmed root domain/);
  rejects(stg({ api: 'https://api.school.uz/api', 'confirm-api-host': 'api.school.uz' }), /does not look like a test host/);
  rejects(stg({ api: 'https://api-staging.school.uz:8443/api', 'confirm-api-host': 'api-staging.school.uz' }), /not the confirmed root domain/);
  assert.equal(resolveTarget(stg({ api: 'https://api-staging.school.uz:8443/api', 'confirm-api-host': 'api-staging.school.uz:8443' })).api, 'https://api-staging.school.uz:8443/api');
});

test('confirmation, root format and test-looking names', () => {
  rejects(stg({ confirm: undefined }), /--confirm must repeat/);
  rejects(stg({ confirm: 'school.uz' }), /--confirm must repeat/);
  rejects({ api: 'https://school.uz/api', root: 'school.uz', confirm: 'school.uz' }, /does not look like a test domain/);
  // "test" inside a longer word is not a test label.
  rejects({ api: 'https://latest.uz/api', root: 'latest.uz', confirm: 'latest.uz' }, /does not look like a test domain/);
  rejects({ api: 'https://contest-school.uz/api', root: 'contest-school.uz', confirm: 'contest-school.uz' }, /does not look like a test domain/);
  assert.equal(looksLikeTestHost('stg.school.uz'), true);
  assert.equal(looksLikeTestHost('school-test.uz'), true);
  assert.ok(resolveTarget({ api: 'https://pilot.school.uz/api', root: 'pilot.school.uz', confirm: 'pilot.school.uz', 'not-a-test-name': true }));
  rejects(stg({ root: 'https://staging.school.uz', confirm: 'https://staging.school.uz' }), /bare domain name/);
  rejects(stg({ root: 'staging.school.uz:443', confirm: 'staging.school.uz:443' }), /bare domain name/);
  rejects(stg({ root: 'staging.school.uz/api', confirm: 'staging.school.uz/api' }), /bare domain name/);
  rejects({}, /usage/);
});

test('malformed URLs, protocols, credentials, ports, paths', () => {
  rejects(stg({ api: 'not a url' }), /not a valid URL/);
  rejects(stg({ api: 'staging.school.uz/api' }), /not a valid URL/);
  rejects(stg({ api: 'ftp://staging.school.uz/api' }), /must be http\(s\)/);
  rejects(stg({ api: 'file:///etc/passwd' }), /must be http\(s\)/);
  rejects(stg({ api: 'javascript:alert(1)' }), /must be http\(s\)/);
  rejects(stg({ api: 'http://staging.school.uz/api' }), /must be https/);
  rejects(stg({ api: 'https://user:secret@staging.school.uz/api' }), /user name or password/);
  rejects(stg({ api: 'https://staging.school.uz@evil.example.com/api' }), /user name or password/);
  rejects(stg({ api: 'https://staging.school.uz/api?next=https://evil.example.com' }), /query string or fragment/);
  rejects(stg({ api: 'https://staging.school.uz/api#x' }), /query string or fragment/);
  rejects(stg({ api: 'https://staging.school.uz/' }), /must end in \/api/);
  rejects(stg({ api: 'https://staging.school.uz/api/v2' }), /must end in \/api/);
  rejects(stg({ api: 'https://staging.school.uz/api/../admin' }), /must end in \/api/);
  rejects(stg({ api: 'https://staging.school.uz:8443/api' }), /default https port/);
  rejects(stg({ api: 'https://203.0.113.7/api', root: 'staging.school.uz' }), /not the confirmed root domain|not an address/);
});

test('local rehearsal is explicit and limited to loopback', () => {
  const t = resolveTarget({ local: true, api: 'http://127.0.0.1:4100/api', root: 'staging.localhost', confirm: 'staging.localhost' });
  assert.equal(t.api, 'http://127.0.0.1:4100/api');
  assert.equal(t.local, true);
  assert.ok(resolveTarget({ local: true, api: 'http://localhost:4100/api', root: 'localhost', confirm: 'localhost' }));
  // Loopback without --local, and --local pointed elsewhere.
  rejects({ api: 'http://127.0.0.1:4100/api', root: 'staging.localhost', confirm: 'staging.localhost' }, /needs --local/);
  rejects({ api: 'https://127.0.0.1/api', root: 'staging.school.uz', confirm: 'staging.school.uz' }, /needs --local/);
  rejects({ local: true, api: 'http://staging.school.uz/api', root: 'staging.localhost', confirm: 'staging.localhost' }, /only a loopback API/);
  rejects({ local: true, api: 'https://school.uz/api', root: 'staging.localhost', confirm: 'staging.localhost' }, /only a loopback API/);
  rejects({ local: true, api: 'http://127.0.0.1.evil.example.com/api', root: 'staging.localhost', confirm: 'staging.localhost' }, /only a loopback API/);
  rejects({ local: true, api: 'http://127.0.0.1:4100/api', root: 'staging.school.uz', confirm: 'staging.school.uz' }, /\.localhost root/);
  rejects({ local: true, api: 'http://192.168.1.10:4100/api', root: 'staging.localhost', confirm: 'staging.localhost' }, /only a loopback API/);
});

test('guardedFetch: only the confirmed hosts, never plain http, never a followed redirect', async () => {
  const seen = [];
  const fake = async (url, init) => { seen.push([String(url), init.redirect]); return { status: 200 }; };
  const t = resolveTarget(stg());
  const f = guardedFetch(t, fake);
  await f('https://staging.school.uz/api/health');
  await f('https://center-a.staging.school.uz/api/health');
  assert.deepEqual(seen.map((s) => s[1]), ['manual', 'manual']);
  for (const url of ['https://school.uz/api/health', 'https://evil.example.com/', 'https://a.b.staging.school.uz/', 'https://staging.school.uz.evil.example.com/', 'https://staging.school.uz:8443/api', 'http://staging.school.uz/api/health', 'https://u:p@staging.school.uz/api']) {
    await assert.rejects(() => f(url), TargetError, url);
  }
  assert.equal(seen.length, 2, 'refused URLs never reach fetch');
  await f('http://staging.school.uz/api/health', { allowPlainHttp: true }); // the http -> https probe only
  assert.equal(seen.length, 3);

  const local = guardedFetch(resolveTarget({ local: true, api: 'http://127.0.0.1:4100/api', root: 'staging.localhost', confirm: 'staging.localhost' }), fake);
  await local('http://127.0.0.1:4100/api/health');
  await assert.rejects(() => local('http://127.0.0.1:4000/api/health'), TargetError, 'another local port (the dev server)');
  await assert.rejects(() => local('http://a.staging.localhost/'), TargetError);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--api', 'x', '--local', '--root', 'r']), { api: 'x', local: true, root: 'r' });
});

// ---- the script itself: a refused configuration makes no request at all
const work = mkdtempSync(join(tmpdir(), 'verify-flows-'));
const spy = join(work, 'fetch-spy.mjs');
const log = join(work, 'calls.log');
writeFileSync(spy, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  appendFileSync(${JSON.stringify(log)}, String(init?.method ?? 'GET') + ' ' + String(url) + '\\n');
  throw new Error('network is not available in this test');
};
`);
const run = (argv) => {
  rmSync(log, { force: true });
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(spy).href, SCRIPT, ...argv], { encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, err: r.stderr, out: r.stdout, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
};

test('verify-flows.mjs: rejected configurations exit before any network call', () => {
  const refused = [
    ['--api', 'https://school.uz/api', '--root', 'staging.school.uz', '--confirm', 'staging.school.uz'],
    ['--api', 'https://evil.example.com/api', '--root', 'staging.school.uz', '--confirm', 'staging.school.uz'],
    ['--api', 'https://staging.school.uz/api', '--root', 'staging.school.uz'],
    ['--api', 'https://school.uz/api', '--root', 'school.uz', '--confirm', 'school.uz'],
    ['--api', 'https://u:p@staging.school.uz/api', '--root', 'staging.school.uz', '--confirm', 'staging.school.uz'],
    ['--api', 'http://staging.school.uz/api', '--root', 'staging.school.uz', '--confirm', 'staging.school.uz'],
    ['--api', 'ftp://staging.school.uz/api', '--root', 'staging.school.uz', '--confirm', 'staging.school.uz'],
    ['--api', 'nonsense', '--root', 'staging.school.uz', '--confirm', 'staging.school.uz'],
    ['--api', 'http://127.0.0.1:4000/api', '--root', 'staging.localhost', '--confirm', 'staging.localhost'],
    ['--local', '--api', 'https://school.uz/api', '--root', 'staging.localhost', '--confirm', 'staging.localhost'],
    ['--api', 'https://api.school.uz/api', '--root', 'staging.school.uz', '--confirm', 'staging.school.uz', '--confirm-api-host', 'api.school.uz'],
    [],
  ];
  for (const argv of refused) {
    const r = run(argv);
    assert.equal(r.code, 2, `exit code for ${argv.join(' ')}: ${r.err}`);
    assert.deepEqual(r.calls, [], `network calls for ${argv.join(' ')}`);
    assert.match(r.err, /refusing|usage/);
  }
});

test('verify-flows.mjs: an accepted configuration does start, against the confirmed host only', () => {
  // The spy fails every request, so nothing is created; this proves the spy
  // sees requests (the zero above is meaningful) and where they would go.
  for (const [argv, origin] of [
    [['--api', 'https://staging.school.uz/api', '--root', 'staging.school.uz', '--confirm', 'staging.school.uz'], 'https://staging.school.uz/'],
    [['--local', '--api', 'http://127.0.0.1:4100/api', '--root', 'staging.localhost', '--confirm', 'staging.localhost'], 'http://127.0.0.1:4100/'],
  ]) {
    const r = run(argv);
    assert.notEqual(r.code, 2, r.err);
    assert.ok(r.calls.length >= 1, 'the run reached the network layer');
    // Every request goes to the confirmed host (the http -> https probe
    // uses plain http on that same host and nothing else does).
    const host = new URL(origin).host;
    for (const c of r.calls) assert.equal(new URL(c.split(' ')[1]).host, host, `unexpected destination: ${c}`);
    for (const c of r.calls.filter((x) => !x.startsWith('GET'))) assert.ok(c.split(' ')[1].startsWith(origin), `a write left the confirmed origin: ${c}`);
  }
});

test.after(() => rmSync(work, { recursive: true, force: true }));
