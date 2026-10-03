// Checks an application instance against what rehearsal-seed.mjs created:
// used on the RESTORED copy (does the application work on it?) and on the
// source afterwards (is it still intact?).
//
//   API=http://127.0.0.1:4000/api SEED_JSON='<json from SEED_RESULT>' node rehearsal-verify.mjs
// Exit code 0 only when every check passes.
import { createHash } from 'node:crypto';

const API = (process.env.API || 'http://127.0.0.1:4000/api').replace(/\/$/, '');
const ORIGIN = API.replace(/\/api$/, '');
const seed = JSON.parse(process.env.SEED_JSON || 'null');
if (!seed) { console.error('SEED_JSON is required'); process.exit(2); }

let failed = 0;
const ok = (name) => console.log(`  ok    ${name}`);
const bad = (name, why) => { failed++; console.log(`  FAIL  ${name} — ${why}`); };
async function check(name, fn) {
  try { const d = await fn(); ok(d ? `${name} — ${d}` : name); } catch (e) { bad(name, e.message); }
}
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
async function call(method, path, { token, body } = {}) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${API}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    // The login rate limit is respected: wait and try again.
    if (res.status !== 429 || attempt >= 5) break;
    await new Promise((r) => setTimeout(r, Math.min(65, Number(res.headers.get('retry-after')) || 20) * 1000));
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, body: json, text };
}
const must = async (what, ...a) => { const r = await call(...a); if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 160)}`); return r.body; };
const login = (email) => must(`login ${email}`, 'POST', '/auth/login', { body: { email, password: seed.password } });

let owner;
await check('owner of center A signs in', async () => {
  const r = await login(seed.a.ownerEmail);
  eq([r.tenant.id, r.user.role], [seed.a.tenantId, 'OWNER'], 'tenant, role');
  owner = r.accessToken;
});
await check('staff member: two centers, a different role in each', async () => {
  const first = await login(seed.staffEmail);
  eq(first.requiresWorkspaceSelection, true, 'asked to choose a center');
  const inA = await must('select A', 'POST', '/auth/select-workspace', { token: first.accessToken, body: { tenantId: seed.a.tenantId, refreshToken: first.refreshToken } });
  const again = await login(seed.staffEmail);
  const inB = await must('select B', 'POST', '/auth/select-workspace', { token: again.accessToken, body: { tenantId: seed.b.tenantId, refreshToken: again.refreshToken } });
  eq([inA.user.role, inB.user.role], ['ACCOUNTANT', 'TEACHER'], 'roles');
  const refreshed = await must('refresh', 'POST', '/auth/refresh', { body: { refreshToken: inB.refreshToken } });
  eq((await must('me', 'GET', '/auth/me', { token: refreshed.accessToken })).tenant.id, seed.b.tenantId, 'refresh keeps center B');
  eq((await call('GET', '/payments', { token: inB.accessToken })).status, 403, 'teacher reading payments');
});
await check('student, group, enrollment and attendance', async () => {
  const s = await must('student', 'GET', `/students/${seed.studentId}`, { token: owner });
  eq([s.fullName, s.enrollments.length, s.enrollments[0].groupId], [seed.studentName, 1, seed.groupId], 'student');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
  const att = await must('attendance', 'GET', `/attendance?groupId=${seed.groupId}`, { token: owner });
  if (!JSON.stringify(att).includes(seed.studentId)) throw new Error(`no attendance mark for the student (looked from ${today})`);
});
await check('invoice, payments, allocations and the discount', async () => {
  const inv = await must('invoice', 'GET', `/invoices/${seed.invoiceId}`, { token: owner });
  eq([inv.amount, inv.amountPaid, inv.remainingAmount, inv.status], [seed.expected.tuition, seed.expected.paid, 0, 'PAID'], 'invoice');
  eq(inv.allocations.reduce((n, a) => n + a.amount, 0), seed.expected.paid, 'sum of allocations');
  const pays = (await must('payments', 'GET', '/payments', { token: owner })).filter((p) => p.studentId === seed.studentId);
  eq([pays.length, pays.reduce((n, p) => n + p.amount, 0), pays.reduce((n, p) => n + (p.discount || 0), 0)], [seed.expected.payments, seed.expected.paid, seed.expected.discount], 'payments');
});
await check('balances: debtors list, finance summary and director report agree', async () => {
  const list = await must('debtors', 'GET', `/payments/debtors?forMonth=${seed.month}`, { token: owner });
  const row = list.debtors.find((d) => d.studentId === seed.studentId);
  eq([row.expectedAmount, row.paidAmount, row.discountAmount, row.debtAmount, row.status], [seed.expected.tuition, seed.expected.paid, seed.expected.discount, 0, 'PAID'], 'debtor row');
  const fin = await must('summary', 'GET', `/payments/finance-summary?forMonth=${seed.month}`, { token: owner });
  eq([fin.totalRevenue, fin.totalOutstandingDebt], [seed.expected.paid, list.totalDebt], 'finance summary');
  const dir = await must('director', 'GET', `/reports/director?month=${seed.month}`, { token: owner });
  const t = dir.trend.find((x) => x.month === seed.month);
  eq([t.collected, t.debt], [seed.expected.paid, list.totalDebt], 'director report');
  return `expected ${seed.expected.tuition}, paid ${seed.expected.paid}, discount ${seed.expected.discount}, debt 0`;
});
await check('the uploaded file is served and is byte-for-byte the same', async () => {
  const center = await must('center', 'GET', `/tenants/by-subdomain/${seed.a.sub}`);
  eq(center.logoUrl, seed.upload.file, 'file name recorded in the database');
  const res = await fetch(`${ORIGIN}/uploads/${seed.upload.file}`);
  if (res.status !== 200) throw new Error(`GET /uploads/${seed.upload.file} -> ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  eq([bytes.length, createHash('sha256').update(bytes).digest('hex')], [seed.upload.bytes, seed.upload.sha256], 'size and sha256');
  return `${bytes.length} bytes, sha256 matches`;
});
await check('the centers stay separate', async () => {
  const b = await login(seed.b.ownerEmail);
  const students = await must('students of B', 'GET', '/students', { token: b.accessToken });
  if (JSON.stringify(students).includes(seed.studentId)) throw new Error("center B sees center A's student");
});

console.log(failed ? `VERIFY FAILED: ${failed} check(s)` : 'VERIFY OK');
process.exit(failed ? 1 : 0);
