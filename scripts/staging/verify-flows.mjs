#!/usr/bin/env node
// Staging verification through the public API: domain and workspace flows,
// staff removal, portals, origins, and the pilot journey with its balances.
// No dependencies (Node 20+).
//
//   node scripts/staging/verify-flows.mjs --api https://staging.example.uz/api --root staging.example.uz --confirm staging.example.uz
//
// It CREATES synthetic data: two centers "ZZ Staging Check ...", a few staff
// accounts, one student, one invoice and payments. Run it only against an
// environment made for testing. To make a mistake hard:
//   --confirm must repeat the root domain, and
//   the root domain must look like a test one (staging / test / stg / dev /
//   localhost) unless --not-a-test-name is given on purpose.
// It sends no Telegram, SMS or e-mail itself and never touches payment
// providers; whether the server sends anything depends on the server's own
// configuration.
//
// Checks that need a browser (cookies / local storage on the subdomain, the
// redirect after login) are NOT covered: this is the API side only.

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : [])).filter((x) => x.length));
const API = String(args.api || '').replace(/\/$/, '');
const ROOT = String(args.root || '').toLowerCase();
if (!API || !ROOT) {
  console.error('usage: verify-flows.mjs --api <https://host/api> --root <root domain> --confirm <root domain>');
  process.exit(2);
}
if (args.confirm !== ROOT) {
  console.error(`refusing: --confirm must repeat the root domain (${ROOT}). This script creates data.`);
  process.exit(2);
}
if (!/(staging|stage|stg|test|dev|localhost)/.test(ROOT) && !args['not-a-test-name']) {
  console.error(`refusing: "${ROOT}" does not look like a test domain. Pass --not-a-test-name only if this really is a staging environment.`);
  process.exit(2);
}
const HTTPS = API.startsWith('https://');
const suffix = Date.now();
const password = `Stg-${suffix}-check`;
const results = [];
let waited = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { token, body, headers } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    // The rate limit is respected, not worked around: wait and try again.
    if ((res.status === 429 || res.status === 503) && attempt < 6) {
      const wait = Math.min(65, Number(res.headers.get('retry-after')) || 20);
      waited += wait;
      await sleep(wait * 1000);
      continue;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
}
const must = async (label, method, path, opts, expected = [200, 201]) => {
  const r = await call(method, path, opts);
  if (![].concat(expected).includes(r.status)) throw new Error(`${label}: ${method} ${path} -> ${r.status} ${r.text.slice(0, 200)}`);
  return r.body;
};
async function check(section, name, fn) {
  try {
    const detail = await fn();
    results.push({ section, name, ok: true, detail: detail || '' });
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ section, name, ok: false, detail: err.message });
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
}
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
const prevMonth = (() => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();

const state = {};

console.log(`Target: ${API}   root domain: ${ROOT}   run: ${suffix}`);

// ----------------------------------------------------------------- setup
console.log('\n1. Environment');
await check('env', 'API health', async () => { const r = await call('GET', '/health'); eq(r.status, 200, 'status'); });
if (HTTPS) {
  await check('env', 'HTTP redirects to HTTPS', async () => {
    const r = await fetch(API.replace('https://', 'http://') + '/health', { redirect: 'manual' });
    if (![301, 308].includes(r.status) || !String(r.headers.get('location')).startsWith('https://')) throw new Error(`status ${r.status}, location ${r.headers.get('location')}`);
  });
  await check('env', 'HSTS header on the main domain', async () => {
    const r = await call('GET', '/health');
    if (!r.headers.get('strict-transport-security')) throw new Error('no Strict-Transport-Security header');
  });
} else {
  results.push({ section: 'env', name: 'HTTPS (redirect, certificate, HSTS)', ok: null, detail: 'not run: the target is not https' });
  console.log('  skip  HTTPS checks — the target is not https');
}

console.log('\n2. Two centers and their staff');
await check('setup', 'two centers register', async () => {
  for (const tag of ['a', 'b']) {
    const sub = `zz-stg-${tag}-${suffix}`;
    const r = await must(`register ${tag}`, 'POST', '/auth/register', { body: { centerName: `ZZ Staging Check ${tag.toUpperCase()} ${suffix}`, subdomain: sub, email: `zz-owner-${tag}-${suffix}@example.test`, password, fullName: `Owner ${tag.toUpperCase()}` } });
    state[tag] = { owner: r.accessToken, ownerRefresh: r.refreshToken, tenantId: r.tenant.id, sub };
  }
  return `${state.a.sub}, ${state.b.sub}`;
});
if (!state.a || !state.b) { console.error('\nCannot continue without the two centers.'); process.exit(1); }
const A = state.a, B = state.b;
const staffEmail = (tag) => `zz-${tag}-${suffix}@example.test`;
const addStaff = (owner, email, role) => must(`add ${role}`, 'POST', '/staff', { token: owner, body: { fullName: `Staging ${role}`, email, password, role } });
const login = (email) => call('POST', '/auth/login', { body: { email, password } });

await check('setup', 'public center lookup by subdomain', async () => {
  const r = await must('lookup', 'GET', `/tenants/by-subdomain/${A.sub}`);
  eq(r.subdomain, A.sub, 'subdomain');
});
if (HTTPS) {
  await check('env', 'HTTPS on a center subdomain (wildcard certificate and routing)', async () => {
    const r = await fetch(`https://${A.sub}.${ROOT}/api/health`);
    eq(r.status, 200, 'status');
  });
  await check('env', 'center subdomain serves the center site', async () => {
    const r = await fetch(`https://${A.sub}.${ROOT}/`);
    eq(r.status, 200, 'status');
  });
}

// ------------------------------------------------- domain / workspace flows
console.log('\n3. Sessions and workspaces');
await check('auth', 'staff login lands in their center, with a refresh token', async () => {
  const u = await addStaff(A.owner, staffEmail('acc'), 'ACCOUNTANT');
  state.acc = { id: u.id };
  const r = await login(staffEmail('acc'));
  eq(r.status, 201, 'login status');
  eq([r.body.tenant.subdomain, r.body.user.role, typeof r.body.refreshToken], [A.sub, 'ACCOUNTANT', 'string'], 'tenant, role, refresh');
  Object.assign(state.acc, { access: r.body.accessToken, refresh: r.body.refreshToken });
});
await check('auth', 'handoff to the center address: one-time code, own session, replay refused', async () => {
  const h = await must('handoff', 'POST', '/auth/handoff', { token: state.acc.access });
  eq(h.subdomain, A.sub, 'subdomain to move to');
  const s = await must('exchange', 'POST', '/auth/handoff/exchange', { body: { code: h.code } });
  eq([s.tenant.subdomain, typeof s.refreshToken], [A.sub, 'string'], 'landed session');
  eq((await call('POST', '/auth/handoff/exchange', { body: { code: h.code } })).status, 401, 'replay');
  state.acc.landed = s;
});
await check('auth', 'refresh keeps the workspace and role (reload after the access token expires)', async () => {
  const r = await must('refresh', 'POST', '/auth/refresh', { body: { refreshToken: state.acc.landed.refreshToken } });
  const me = await must('me', 'GET', '/auth/me', { token: r.accessToken });
  eq([me.tenant.subdomain, me.user.role], [A.sub, 'ACCOUNTANT'], 'tenant, role');
  state.acc.landed = { ...state.acc.landed, accessToken: r.accessToken, refreshToken: r.refreshToken };
});
await check('auth', 'one person, two centers: the right role in each', async () => {
  const email = staffEmail('two');
  const u = await addStaff(A.owner, email, 'MANAGER');
  await addStaff(B.owner, email, 'TEACHER');
  const first = (await login(email)).body;
  eq(first.requiresWorkspaceSelection, true, 'asked to choose');
  const inA = await must('select A', 'POST', '/auth/select-workspace', { token: first.accessToken, body: { tenantId: A.tenantId, refreshToken: first.refreshToken } });
  const again = (await login(email)).body;
  const inB = await must('select B', 'POST', '/auth/select-workspace', { token: again.accessToken, body: { tenantId: B.tenantId, refreshToken: again.refreshToken } });
  eq([inA.user.role, inB.user.role], ['MANAGER', 'TEACHER'], 'roles');
  // The TEACHER in B may not read B's payments; the MANAGER in A may read A's.
  eq((await call('GET', '/payments', { token: inB.accessToken })).status, 403, 'teacher reads payments in B');
  eq((await call('GET', '/payments', { token: inA.accessToken })).status, 200, 'manager reads payments in A');
  const rB = await must('refresh B', 'POST', '/auth/refresh', { body: { refreshToken: inB.refreshToken } });
  eq((await must('me B', 'GET', '/auth/me', { token: rB.accessToken })).tenant.id, B.tenantId, 'refresh stays in B');
  state.two = { id: u.id, email, inA, inB: { ...inB, accessToken: rB.accessToken, refreshToken: rB.refreshToken } };
});
await check('auth', 'a workspace the user does not belong to is refused', async () => {
  eq((await call('POST', '/auth/select-workspace', { token: state.acc.access, body: { tenantId: B.tenantId } })).status, 401, 'select another center');
  eq((await call('GET', `/students`, { token: state.acc.access, headers: { 'x-tenant-id': B.tenantId } })).status, 200, 'own list still works');
  const mine = await must('students', 'GET', '/students', { token: state.acc.access });
  eq(JSON.stringify(mine).includes(B.tenantId), false, "no data of the other center");
});

console.log('\n4. Removing a member');
await check('removal', 'removed from A: tokens, refresh, login-to-A, workspace choice and an old handoff code all fail', async () => {
  const before = await must('handoff before removal', 'POST', '/auth/handoff', { token: state.two.inA.accessToken });
  await must('remove', 'DELETE', `/staff/${state.two.id}`, { token: A.owner }, 200);
  const t = state.two.inA;
  eq((await call('GET', '/groups', { token: t.accessToken })).status, 401, 'old access token');
  eq((await call('GET', '/auth/me', { token: t.accessToken })).status, 401, '/me');
  eq((await call('POST', '/auth/refresh', { body: { refreshToken: t.refreshToken } })).status, 401, 'refresh');
  eq((await call('POST', '/auth/handoff/exchange', { body: { code: before.code } })).status, 401, 'handoff code issued before');
  const again = await login(state.two.email);
  eq(again.status, 201, 'login (still a member of B)');
  eq([again.body.tenant.id, (again.body.workspaces || []).map((w) => w.tenantId).includes(A.tenantId)], [B.tenantId, false], 'lands in B, A not offered');
  eq((await call('POST', '/auth/select-workspace', { token: again.body.accessToken, body: { tenantId: A.tenantId } })).status, 401, 'choosing A');
});
await check('removal', 'the other center keeps working for the same person', async () => {
  const me = await must('me', 'GET', '/auth/me', { token: state.two.inB.accessToken });
  eq([me.tenant.id, me.user.role], [B.tenantId, 'TEACHER'], 'B session');
  await must('refresh', 'POST', '/auth/refresh', { body: { refreshToken: state.two.inB.refreshToken } });
});
await check('removal', 'a member with one center: removed means no way in at all, until added again', async () => {
  const email = staffEmail('solo');
  const u = await addStaff(A.owner, email, 'RECEPTIONIST');
  const s = (await login(email)).body;
  await must('remove', 'DELETE', `/staff/${u.id}`, { token: A.owner }, 200);
  eq((await call('GET', '/groups', { token: s.accessToken })).status, 401, 'old token');
  eq((await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } })).status, 401, 'refresh');
  eq((await login(email)).status, 401, 'new login');
  await addStaff(A.owner, email, 'RECEPTIONIST');
  eq((await login(email)).status, 201, 'login after being added again');
  state.desk = { email };
});

console.log('\n5. Origins');
await check('cors', 'the main domain and a center subdomain are allowed origins', async () => {
  // In production the API accepts the root domain and one level of center
  // subdomains, over https only.
  for (const origin of [`https://${ROOT}`, `https://${A.sub}.${ROOT}`]) {
    const r = await call('GET', '/health', { headers: { Origin: origin } });
    eq(r.headers.get('access-control-allow-origin'), origin, `allow-origin for ${origin}`);
  }
});
await check('cors', 'an unrelated origin and a look-alike domain are not allowed', async () => {
  for (const origin of ['https://evil.example.com', `https://${ROOT}.evil.example.com`, `https://evil${ROOT}`, `https://a.b.${ROOT}`, `http://plain-http.${ROOT}`]) {
    const r = await call('GET', '/health', { headers: { Origin: origin } });
    if (r.headers.get('access-control-allow-origin')) throw new Error(`${origin} was allowed`);
    const pre = await call('OPTIONS', '/auth/login', { headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    if (pre.headers.get('access-control-allow-origin')) throw new Error(`preflight from ${origin} was allowed`);
  }
});
await check('cors', 'no token, a broken token and a portal token are refused by the back office', async () => {
  eq((await call('GET', '/students')).status, 401, 'no token');
  eq((await call('GET', '/students', { token: 'not.a.token' })).status, 401, 'garbage token');
});

// ------------------------------------------------------------- the journey
console.log('\n6. Pilot journey');
const phone = `+99894${String(suffix).slice(-7)}`;
const parentPhone = `+99895${String(suffix).slice(-7)}`;
await check('journey', 'teacher, group, invited staff', async () => {
  const teacher = await must('teacher', 'POST', '/teachers', { token: A.owner, body: { fullName: 'Staging Teacher', subject: 'English' } });
  const g = await must('group', 'POST', '/groups', { token: A.owner, body: { name: 'Staging English', subject: 'English', monthlyPrice: 400000, teacherId: teacher.id, maxStudents: 10 } });
  state.groupId = g.id;
  const inv = await must('invite', 'POST', '/invitations', { token: A.owner, body: { email: staffEmail('invited'), role: 'MANAGER' } });
  await must('accept', 'POST', `/invitations/${inv.token}/accept`, { body: { fullName: 'Invited Manager', password } });
  const r = await login(staffEmail('invited'));
  eq([r.status, r.body?.user?.role, r.body?.tenant?.id], [201, 'MANAGER', A.tenantId], 'invited staff login');
  state.manager = r.body.accessToken;
});
await check('journey', 'lead → contacted → trial attended → qualified', async () => {
  const lead = await must('lead', 'POST', '/leads', { token: state.manager, body: { fullName: 'Staging Student', phone, source: 'WALK_IN' } });
  state.leadId = lead.id;
  await must('contacted', 'POST', `/leads/${lead.id}/transition`, { token: state.manager, body: { toStatus: 'CONTACTED' } });
  const day = new Date(Date.now() + 3 * 86400000 + 5 * 3600000).toISOString().slice(0, 10);
  const trial = await must('trial', 'POST', `/leads/${lead.id}/trials`, { token: state.manager, body: { scheduledAt: `${day}T07:00:00+05:00` } });
  await must('attend', 'POST', `/leads/${lead.id}/trials/${trial.id}/attend`, { token: state.manager, body: {} });
  await must('qualified', 'POST', `/leads/${lead.id}/transition`, { token: A.owner, body: { toStatus: 'QUALIFIED' } });
});
await check('journey', 'enrollment with the first invoice; attendance', async () => {
  const r = await must('convert', 'POST', `/leads/${state.leadId}/convert`, { token: A.owner, body: { groupIds: [state.groupId], guardianPhone: parentPhone, createInvoice: true, invoiceForMonth: month, invoiceDueDate: `${today}T12:00:00.000Z` } });
  eq([r.studentCreated, r.invoice.amount, r.invoice.status], [true, 400000, 'OPEN'], 'student and invoice');
  state.studentId = r.student.id;
  state.invoiceId = r.invoice.id;
  const marks = await must('attendance', 'POST', '/attendance', { token: A.owner, body: { groupId: state.groupId, date: today, entries: [{ studentId: state.studentId, status: 'PRESENT' }] } });
  eq(marks.length, 1, 'marks');
});
await check('journey', 'roles: the front desk cannot take a payment; the accountant can, once per retry key', async () => {
  const desk = (await login(state.desk.email)).body.accessToken;
  eq((await call('POST', '/payments', { token: desk, body: { studentId: state.studentId, amount: 150000, forMonth: month, method: 'CASH' } })).status, 403, 'front desk');
  const acc = state.acc.landed.accessToken;
  const body = { studentId: state.studentId, amount: 150000, forMonth: month, method: 'CASH', idempotencyKey: `stg-${suffix}-1` };
  const p1 = await must('payment', 'POST', '/payments', { token: acc, body });
  const p2 = await must('same payment again', 'POST', '/payments', { token: acc, body });
  eq(p2.id, p1.id, 'retry returns the first payment');
  eq((await call('POST', '/payments', { token: acc, body: { ...body, amount: 160000 } })).status, 409, 'same key, other contents');
  eq((await call('POST', '/payments', { token: acc, body: { studentId: state.studentId, invoiceId: state.invoiceId, amount: 300000, forMonth: month, method: 'CASH' } })).status, 400, 'overpayment');
  await must('rest with a discount', 'POST', '/payments', { token: acc, body: { studentId: state.studentId, amount: 240000, discount: 10000, forMonth: month, method: 'CASH' } });
  const inv = await must('invoice', 'GET', `/invoices/${state.invoiceId}`, { token: acc });
  eq([inv.amountPaid, inv.remainingAmount, inv.status], [390000, 0, 'PAID'], 'invoice');
});
await check('journey', 'the same balance on the payments page, finance summary, director report and the portal', async () => {
  const acc = state.acc.landed.accessToken;
  const list = await must('debtors', 'GET', `/payments/debtors?forMonth=${month}`, { token: acc });
  const row = list.debtors.find((d) => d.studentId === state.studentId);
  eq([row.expectedAmount, row.paidAmount, row.discountAmount, row.debtAmount, row.status], [400000, 390000, 10000, 0, 'PAID'], 'debtor row');
  const fin = await must('summary', 'GET', `/payments/finance-summary?forMonth=${month}`, { token: acc });
  eq([fin.totalRevenue, fin.totalOutstandingDebt, fin.debtorCount], [390000, list.totalDebt, list.debtorCount], 'finance summary');
  const dir = await must('director', 'GET', `/reports/director?month=${month}`, { token: A.owner });
  const t = dir.trend.find((x) => x.month === month);
  eq([t.debt, t.expected, t.collected], [list.totalDebt, list.totalExpected, 390000], 'director report');
  const { pin } = await must('pin', 'POST', `/students/${state.studentId}/portal-pin`, { token: A.owner });
  for (const [who, ph] of [['student', phone], ['parent', parentPhone]]) {
    const tok = (await must(`${who} portal login`, 'POST', '/portal/auth/phone/verify', { body: { phone: ph, pin } })).accessToken;
    const me = await must(`${who} me`, 'GET', '/portal/me', { token: tok });
    eq([me.id, me.viewer], [state.studentId, who], `${who} cabinet`);
    const pay = await must(`${who} payments`, 'GET', '/portal/payments', { token: tok });
    eq([pay.expectedTuition, pay.monthPaid, pay.debtAmount, pay.status, pay.history.length], [400000, 390000, 0, 'PAID', 2], `${who} balance`);
    eq((await call('GET', '/payments', { token: tok })).status, 403, `${who} token in the back office`);
    state[`${who}Portal`] = tok;
  }
  return `expected 400 000, paid 390 000, discount 10 000, debt 0 everywhere`;
});
await check('journey', 'a past month has no invented debt; a confirmed price is applied from its month', async () => {
  const acc = state.acc.landed.accessToken;
  const before = await must('debtors', 'GET', `/payments/debtors?forMonth=${prevMonth}`, { token: acc });
  // The student joined this month: nothing is owed for the month before.
  eq(before.debtors.some((d) => d.studentId === state.studentId), false, 'student listed for the previous month');
  eq((await call('POST', `/groups/${state.groupId}/price-history`, { token: state.manager, body: { month: prevMonth, monthlyPrice: 350000 } })).status, 403, 'manager confirming a price');
  const hist = await must('confirm', 'POST', `/groups/${state.groupId}/price-history`, { token: acc, body: { month: prevMonth, monthlyPrice: 350000, note: 'staging check' } });
  eq(hist.some((h) => h.monthlyPrice === 350000 && h.source === 'RECORDED'), true, 'recorded price in history');
  const now = await must('debtors', 'GET', `/payments/debtors?forMonth=${month}`, { token: acc });
  eq(now.debtors.find((d) => d.studentId === state.studentId).expectedAmount, 400000, "this month's invoice is unchanged");
});
await check('journey', 'useful errors', async () => {
  const acc = state.acc.landed.accessToken;
  const r = await call('POST', '/payments', { token: acc, body: { studentId: state.studentId, amount: 1000, forMonth: '2026-13' } });
  if (r.status !== 400 || !JSON.stringify(r.body.message).includes('YYYY-MM')) throw new Error(`bad month: ${r.status} ${r.text.slice(0, 120)}`);
  const n = await call('GET', '/invoices/does-not-exist', { token: acc });
  if (n.status !== 404 || !n.body?.message) throw new Error(`missing invoice: ${n.status}`);
});

// ---------------------------------------------------------------- summary
const failed = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === null);
console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed.length} failed, ${skipped.length} not run${waited ? `; waited ${waited}s for rate limits` : ''}`);
console.log(`Synthetic data left in place: centers ${A.sub} and ${B.sub} (run ${suffix}).`);
if (args.json) (await import('node:fs')).writeFileSync(String(args.json), JSON.stringify({ api: API, root: ROOT, run: suffix, results }, null, 2));
process.exit(failed.length ? 1 : 0);
