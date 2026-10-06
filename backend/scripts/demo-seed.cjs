#!/usr/bin/env node
/* eslint-disable */
// Local demo: fills one center with staff for every role, teachers, groups,
// students, payments, attendance, leads and an announcement, so the site can
// be clicked through by hand. Everything goes through the running API (the
// same rules as the pages); only the cabinet PINs and the platform admin are
// written straight to the database, so their sign-ins stay the same.
//
//   node scripts/demo-seed.cjs            (backend running on :4000)
//   API_URL=http://localhost:4000/api node scripts/demo-seed.cjs
//
// The center, logins and PINs are fixed (see the table it prints). Running it
// again on a database that already has the demo center does nothing.
// Never for production: it refuses NODE_ENV=production and non-local APIs.
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const API = process.env.API_URL || 'http://localhost:4000/api';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo12345';
const PIN = '123456';
const SUB = 'bilimdon';
const DOMAIN = 'bilimdon.uz';

if (process.env.NODE_ENV === 'production') {
  console.error('demo-seed: NODE_ENV=production - refusing.');
  process.exit(1);
}
const apiHost = new URL(API).hostname;
if (!['localhost', '127.0.0.1', 'backend'].includes(apiHost)) {
  console.error(`demo-seed: ${API} is not a local API - refusing.`);
  process.exit(1);
}

async function api(method, path, { token, body } = {}) {
  for (;;) {
    const res = await fetch(API + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    // Sign-up and sign-in allow 8 a minute from one address: wait it out.
    if (res.status === 429) {
      process.stdout.write('  (rate limit, waiting 20s)\n');
      await new Promise((r) => setTimeout(r, 20_000));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
}

const tz = 'Asia/Tashkent';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
const month = today.slice(0, 7);
const daysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - n * 86_400_000));

// Right after `docker compose up` the API may still be applying migrations.
async function waitForApi() {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) return;
    } catch {
      // not listening yet
    }
    if (i === 0) console.log(`demo-seed: waiting for ${API} ...`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${API} did not answer - is the backend running?`);
}

async function main() {
  await waitForApi();
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const exists = await db.query('SELECT id FROM tenants WHERE subdomain = $1', [SUB]);
  if (exists.rowCount) {
    console.log(`demo-seed: the "${SUB}" center already exists - nothing to do.`);
    const phones = await portalPhones(db);
    await db.end();
    printTable(phones);
    return;
  }

  console.log('demo-seed: creating the center and its owner...');
  const reg = await api('POST', '/auth/register', {
    body: { centerName: "Bilimdon o'quv markazi", subdomain: SUB, email: `owner@${DOMAIN}`, password: PASSWORD, fullName: 'Aziz Karimov' },
  });
  const owner = reg.accessToken;
  await api('POST', '/onboarding/complete', { token: owner });

  console.log('demo-seed: staff (admin, manager, reception, accountant)...');
  const staff = [
    ['ADMIN', 'admin', 'Dilnoza Yusupova'],
    ['MANAGER', 'manager', 'Sardor Rahimov'],
    ['RECEPTIONIST', 'reception', 'Malika Tursunova'],
    ['ACCOUNTANT', 'accountant', 'Bekzod Aliyev'],
  ];
  for (const [role, local, fullName] of staff) {
    await api('POST', '/staff', { token: owner, body: { fullName, email: `${local}@${DOMAIN}`, password: PASSWORD, role } });
  }

  console.log('demo-seed: teachers with their own sign-in...');
  const teacherDefs = [
    ['Nodira Ismoilova', 'Ingliz tili', 'teacher'],
    ['Jamshid Qodirov', 'Matematika', 'teacher2'],
    ['Gulnora Saidova', 'Rus tili', 'teacher3'],
  ];
  const teachers = [];
  for (const [fullName, subject, local] of teacherDefs) {
    const t = await api('POST', '/teachers', { token: owner, body: { fullName, subject, phone: `+99890${String(1000000 + teachers.length * 111111).slice(0, 7)}`, salaryType: 'PERCENTAGE', salaryValue: 40 } });
    await api('POST', `/teachers/${t.id}/account`, { token: owner, body: { email: `${local}@${DOMAIN}`, password: PASSWORD } });
    teachers.push(t);
  }

  console.log('demo-seed: groups...');
  const groupDefs = [
    ['IELTS 6.5+ (kechki)', 'Ingliz tili', 0, 'Dushanba,Chorshanba,Juma', '18:00', '19:30', 600_000, 'B2'],
    ['General English A2', 'Ingliz tili', 0, 'Seshanba,Payshanba,Shanba', '14:00', '15:30', 450_000, 'A2'],
    ['Matematika DTM', 'Matematika', 1, 'Dushanba,Chorshanba,Juma', '10:00', '11:30', 500_000, null],
    ['Rus tili boshlang\'ich', 'Rus tili', 2, 'Seshanba,Payshanba', '16:00', '17:30', 400_000, null],
  ];
  const groups = [];
  for (const [name, subject, ti, scheduleDays, startTime, endTime, monthlyPrice, level] of groupDefs) {
    groups.push(await api('POST', '/groups', {
      token: owner,
      body: { name, subject, teacherId: teachers[ti].id, scheduleDays, startTime, endTime, monthlyPrice, maxStudents: 12, status: 'ACTIVE', startDate: daysAgo(60), ...(level ? { level } : {}) },
    }));
  }

  console.log('demo-seed: students...');
  const studentDefs = [
    ['Ali Valiyev', 0, 'MALE'], ['Madina Ergasheva', 0, 'FEMALE'], ['Otabek Sobirov', 0, 'MALE'],
    ['Zarina Hasanova', 1, 'FEMALE'], ['Javohir Normatov', 1, 'MALE'], ['Shahzoda Mirzayeva', 1, 'FEMALE'],
    ['Bobur Toshmatov', 2, 'MALE'], ['Nilufar Abdullayeva', 2, 'FEMALE'], ['Sherzod Umarov', 2, 'MALE'],
    ['Kamola Rustamova', 3, 'FEMALE'], ['Doniyor Jo\'rayev', 3, 'MALE'], ['Sevara Qosimova', 3, 'FEMALE'],
  ];
  const students = [];
  for (let i = 0; i < studentDefs.length; i++) {
    const [fullName, gi, gender] = studentDefs[i];
    const n = String(i + 1).padStart(2, '0');
    const s = await api('POST', '/students', {
      token: owner,
      body: { fullName, gender, phone: `+9989011100${n}`, parentPhone: `+9989022200${n}`, groupIds: [groups[gi].id], startDate: daysAgo(45) },
    });
    students.push({ ...s, gi });
  }

  console.log('demo-seed: this month\'s payments (paid, part-paid, unpaid)...');
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const price = groupDefs[s.gi][6];
    const kind = i % 3; // 0 paid in full, 1 half, 2 nothing yet
    if (kind === 2) continue;
    await api('POST', '/payments', {
      token: owner,
      body: { studentId: s.id, amount: kind === 0 ? price : price / 2, forMonth: month, method: i % 2 ? 'CLICK' : 'CASH', idempotencyKey: `demo-${s.id}-${month}` },
    });
  }

  console.log('demo-seed: attendance for recent lessons...');
  for (let g = 0; g < groups.length; g++) {
    const members = students.filter((s) => s.gi === g);
    for (const ago of [1, 3, 5]) {
      try {
        await api('POST', '/attendance', {
          token: owner,
          body: { groupId: groups[g].id, date: daysAgo(ago), entries: members.map((s, k) => ({ studentId: s.id, status: k === ago % members.length ? 'ABSENT' : 'PRESENT' })) },
        });
      } catch {
        // Not a lesson day for this group - the API says so; skip it.
      }
    }
  }

  console.log('demo-seed: expenses, leads, an announcement...');
  for (const [title, category, amount] of [['Ofis ijarasi', 'RENT', 4_000_000], ['Internet', 'UTILITIES', 300_000], ['Instagram reklama', 'MARKETING', 1_200_000]]) {
    try {
      await api('POST', '/expenses', { token: owner, body: { title, category, amount, paymentMethod: 'CASH', date: daysAgo(2) } });
    } catch (e) {
      await api('POST', '/expenses', { token: owner, body: { title, amount, paymentMethod: 'CASH', date: daysAgo(2) } });
    }
  }
  for (const [fullName, phone, source] of [['Laylo Karimova', '+998933330001', 'INSTAGRAM'], ['Timur Azimov', '+998933330002', 'TELEGRAM'], ['Feruza Nazarova', '+998933330003', 'WEBSITE'], ['Akmal Xolmatov', '+998933330004', 'INSTAGRAM']]) {
    await api('POST', '/leads', { token: owner, body: { fullName, phone, source } });
  }
  await api('POST', '/announcements', {
    token: owner,
    body: { title: 'Yangi IELTS guruhi', content: "Keyingi oydan yangi IELTS 7.0 guruhi ochiladi. Ro'yxatdan o'tish qabulxonada.", targetAudience: 'ALL', priority: 'NORMAL' },
  });

  console.log('demo-seed: cabinet PINs and the platform admin...');
  const pinHash = await bcrypt.hash(PIN, 10);
  for (const s of students) {
    await db.query(
      `INSERT INTO student_portal_pins (student_id, pin_hash) VALUES ($1, $2)
       ON CONFLICT (student_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = now()`,
      [s.id, pinHash],
    );
  }
  await upsertSuperadmin(db);

  const phones = await portalPhones(db);
  await db.end();
  printTable(phones);
}

// The platform admin (SUPERADMIN) has no sign-up of its own (RUNBOOK.md 9).
async function upsertSuperadmin(db) {
  const email = `superadmin@${DOMAIN}`;
  const hash = await bcrypt.hash(PASSWORD, 10);
  const found = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (found.rowCount) {
    await db.query(`UPDATE users SET role = 'SUPERADMIN', password_hash = $2 WHERE email = $1`, [email, hash]);
    return;
  }
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`)).rows.map((r) => r.column_name);
  const row = { id: `demo_superadmin_${Date.now().toString(36)}`, email, full_name: 'Platform Admin', password_hash: hash, role: 'SUPERADMIN' };
  if (cols.includes('email_verified')) row.email_verified = true;
  const keys = Object.keys(row).filter((k) => cols.includes(k));
  await db.query(`INSERT INTO users (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => row[k]));
}

async function portalPhones(db) {
  const r = await db.query(
    `SELECT s.full_name, s.phone, s.parent_phone FROM students s JOIN tenants t ON t.id = s.tenant_id
     WHERE t.subdomain = $1 AND s.deleted_at IS NULL ORDER BY s.phone LIMIT 3`,
    [SUB],
  );
  return r.rows;
}

function printTable(phones) {
  const site = `http://${SUB}.localhost:3000`;
  const rows = [
    ['Platforma admini (SUPERADMIN)', `superadmin@${DOMAIN}`, PASSWORD, 'http://localhost:3000/login'],
    ['Markaz egasi (OWNER)', `owner@${DOMAIN}`, PASSWORD, `${site}/login`],
    ['Administrator (ADMIN)', `admin@${DOMAIN}`, PASSWORD, `${site}/login`],
    ['Menejer (MANAGER)', `manager@${DOMAIN}`, PASSWORD, `${site}/login`],
    ['Qabulxona (RECEPTIONIST)', `reception@${DOMAIN}`, PASSWORD, `${site}/login`],
    ['Buxgalter (ACCOUNTANT)', `accountant@${DOMAIN}`, PASSWORD, `${site}/login`],
    ['O\'qituvchi (TEACHER)', `teacher@${DOMAIN}`, PASSWORD, `${site}/login`],
  ];
  for (const p of phones) {
    rows.push([`O'quvchi kabineti - ${p.full_name}`, p.phone, `PIN ${PIN}`, `${site}/portal`]);
    rows.push([`Ota-ona kabineti - ${p.full_name}`, p.parent_phone, `PIN ${PIN}`, `${site}/portal`]);
  }
  console.log('\nDemo tayyor. Kirish ma\'lumotlari (faqat lokal demo uchun):\n');
  for (const [who, login, secret, url] of rows) console.log(`  ${who.padEnd(42)} ${String(login).padEnd(26)} ${secret.padEnd(12)} ${url}`);
  console.log(`\n  Markaz sayti: ${site}    Asosiy sayt: http://localhost:3000\n`);
}

main().catch((e) => {
  console.error('demo-seed failed:', e.message);
  process.exit(1);
});
