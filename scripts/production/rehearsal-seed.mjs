// Synthetic data for the restore rehearsal, created through the public API
// (so it is the application's own data, not hand-written SQL): two centers,
// staff with memberships, a student in a group with attendance, an invoice
// paid in two payments with a discount, and an uploaded file that the
// database refers to.
//
// Runs inside the backend container (or anywhere with Node 20+):
//   API=http://127.0.0.1:4000/api node rehearsal-seed.mjs
// Prints one line:  SEED_RESULT=<json>   (synthetic credentials only).
import { createHash, randomBytes } from 'node:crypto';

const API = (process.env.API || 'http://127.0.0.1:4000/api').replace(/\/$/, '');
const run = process.env.SEED_RUN || String(Date.now());
const password = `Reh-${run}-pass`;
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());

async function call(method, path, { token, body, form } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const centers = {};
for (const tag of ['a', 'b']) {
  const sub = `reh-${tag}-${run}`;
  const r = await call('POST', '/auth/register', { body: { centerName: `Rehearsal ${tag.toUpperCase()} ${run}`, subdomain: sub, email: `reh-owner-${tag}-${run}@example.test`, password, fullName: `Owner ${tag.toUpperCase()}` } });
  centers[tag] = { owner: r.accessToken, tenantId: r.tenant.id, sub, ownerEmail: `reh-owner-${tag}-${run}@example.test` };
}
const A = centers.a, B = centers.b;

// One person in both centers, with a different role in each.
const staffEmail = `reh-staff-${run}@example.test`;
await call('POST', '/staff', { token: A.owner, body: { fullName: 'Rehearsal Staff', email: staffEmail, password, role: 'ACCOUNTANT' } });
await call('POST', '/staff', { token: B.owner, body: { fullName: 'Rehearsal Staff', email: staffEmail, password, role: 'TEACHER' } });

const group = await call('POST', '/groups', { token: A.owner, body: { name: `Rehearsal Group ${run}`, subject: 'English', monthlyPrice: 400000 } });
const student = await call('POST', '/students', { token: A.owner, body: { fullName: `Rehearsal Student ${run}`, groupIds: [group.id] } });
const detail = await call('GET', `/students/${student.id}`, { token: A.owner });
const enrollmentId = detail.enrollments[0].id;
await call('POST', '/attendance', { token: A.owner, body: { groupId: group.id, date: today, entries: [{ studentId: student.id, status: 'PRESENT' }] } });
const invoice = await call('POST', '/invoices', { token: A.owner, body: { studentId: student.id, enrollmentId, amount: 400000, dueDate: `${today}T12:00:00.000Z`, forMonth: month } });
await call('POST', '/payments', { token: A.owner, body: { studentId: student.id, amount: 150000, forMonth: month, method: 'CASH', idempotencyKey: `reh-${run}-1` } });
await call('POST', '/payments', { token: A.owner, body: { studentId: student.id, amount: 240000, discount: 10000, forMonth: month, method: 'CASH', idempotencyKey: `reh-${run}-2` } });
// A student in the other center too, so the two are distinguishable.
await call('POST', '/students', { token: B.owner, body: { fullName: `Rehearsal Other ${run}` } });

// An uploaded file the database refers to: the center's logo (tenants.logo_url).
const bytes = randomBytes(48 * 1024);
const form = new FormData();
form.append('file', new Blob([bytes], { type: 'image/png' }), 'rehearsal-logo.png');
const withLogo = await call('POST', '/tenants/me/logo', { token: A.owner, form });
if (!withLogo.logoUrl) throw new Error('the logo upload returned no file name');

const result = {
  run, month, password,
  a: { tenantId: A.tenantId, sub: A.sub, ownerEmail: A.ownerEmail },
  b: { tenantId: B.tenantId, sub: B.sub, ownerEmail: B.ownerEmail },
  staffEmail,
  studentId: student.id, studentName: `Rehearsal Student ${run}`, groupId: group.id, invoiceId: invoice.id,
  expected: { tuition: 400000, paid: 390000, discount: 10000, debt: 0, payments: 2 },
  upload: { file: withLogo.logoUrl, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
};
console.log(`SEED_RESULT=${JSON.stringify(result)}`);
