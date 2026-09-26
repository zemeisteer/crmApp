import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { zonedParts } from '../src/common/timezone.js';

// GET /reports/overview: exact numbers on a small known data set, tenant
// isolation, and per-role trimming of sections.
describe('Reports overview (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const now = zonedParts(new Date(), 'Asia/Tashkent');
  const month = `${now.year}-${String(now.month).padStart(2, '0')}`;
  const day = (d: number) => `${month}-${String(d).padStart(2, '0')}`;
  let g1: string;
  let g2: string;
  let s2: string;

  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  async function register(tag: string) {
    const res = await http().post('/api/auth/register')
      .send({ centerName: `Rep ${tag} ${suffix}`, subdomain: `rep-${tag}-${suffix}`, email: `rep-${tag}-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    tokens.OWNER = await register('a');
    tokens.B = await register('b');
    for (const role of ['ACCOUNTANT', 'MANAGER', 'TEACHER']) {
      const inv = await http().post('/api/invitations').set(as('OWNER')).send({ email: `${role}-${suffix}@test.uz`, role }).expect(201);
      tokens[role] = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: role, password: 'password12345' }).expect(201)).body.accessToken;
    }

    const group = async (token: string, name: string, maxStudents: number, monthlyPrice: number) =>
      (await http().post('/api/groups').set({ Authorization: `Bearer ${token}` }).send({ name, subject: 'Math', maxStudents, monthlyPrice }).expect(201)).body.id as string;
    g1 = await group(tokens.OWNER, 'G1', 10, 500_000);
    g2 = await group(tokens.OWNER, 'G2', 4, 300_000);
    const student = async (fullName: string, groupIds: string[]) =>
      (await http().post('/api/students').set(as('OWNER')).send({ fullName, groupIds }).expect(201)).body.id as string;
    const s1 = await student('S1', [g1]);
    s2 = await student('S2', [g1]);
    await student('S3', [g2]);
    const s4 = await student('S4 left', [g2]);
    await http().patch(`/api/students/${s4}`).set(as('OWNER')).send({ status: 'LEFT' }).expect(200);
    const s5 = await student('S5 dropped', [g2]);
    await http().delete(`/api/students/${s5}/enroll/${g2}`).set(as('OWNER')).expect(200);

    // S1 is invoiced 500k for the month and pays it in full.
    const s1Detail = await http().get(`/api/students/${s1}`).set(as('OWNER')).expect(200);
    const enrollmentId = s1Detail.body.enrollments.find((e: { groupId: string }) => e.groupId === g1).id;
    const invoice = await http().post('/api/invoices').set(as('OWNER'))
      .send({ studentId: s1, enrollmentId, amount: 500_000, dueDate: new Date(Date.now() + 86_400_000).toISOString(), forMonth: month })
      .expect(201);
    await http().post('/api/payments').set(as('OWNER'))
      .send({ studentId: s1, amount: 500_000, method: 'CLICK', forMonth: month, invoiceId: invoice.body.id }).expect(201);

    // S2: 1 present out of 4 marks in G1 -> 25% (at risk).
    for (const [d, status] of [[1, 'PRESENT'], [2, 'ABSENT'], [3, 'ABSENT'], [4, 'ABSENT']] as const) {
      await http().post('/api/attendance').set(as('OWNER')).send({ groupId: g1, date: day(d), entries: [{ studentId: s2, status }] }).expect(201);
    }

    // Tenant B has its own data that must never show up in A's report.
    const gb = await group(tokens.B, 'GB', 5, 999_000);
    await http().post('/api/students').set(as('B')).send({ fullName: 'B student', groupIds: [gb] }).expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('reports exact, tenant-scoped numbers for the month', async () => {
    const res = await http().get(`/api/reports/overview?month=${month}`).set(as('OWNER')).expect(200);
    const r = res.body;
    // S1, S2, S3 and S5 are ACTIVE students; S4 left.
    expect(r.students.active).toBe(4);
    expect(r.students.newThisMonth).toBe(5);
    expect(r.students.byStatus).toEqual({ ACTIVE: 4, LEFT: 1 });

    expect(r.groups.active).toBe(2);
    const G1 = r.groups.items.find((g: { id: string }) => g.id === g1);
    const G2 = r.groups.items.find((g: { id: string }) => g.id === g2);
    expect(G1).toMatchObject({ students: 2, occupancy: 20, attendanceRate: 25, collected: 500_000 });
    // G2 counts only S3: S4 left the center, S5's enrollment was cancelled.
    expect(G2).toMatchObject({ students: 1, occupancy: 25, attendanceRate: null, collected: 0 });
    expect(r.groups.averageOccupancy).toBe(21.4);

    expect(r.attendance).toMatchObject({ marks: 4, rate: 25 });
    expect(r.atRisk).toEqual([expect.objectContaining({ studentId: s2, attendanceRate: 25, risk: 'MEDIUM' })]);

    // Expected: S1 + S2 in G1 (2 x 500k) + S3 in G2 (300k). Not S4 (left)
    // or S5 (cancelled) — those used to inflate expected revenue and debt.
    expect(r.finance).toMatchObject({ collected: 500_000, expected: 1_300_000, outstandingDebt: 800_000, debtorCount: 2, collectionRate: 38.5 });
    expect(r.finance.revenueByMethod).toEqual({ CLICK: 500_000 });
    expect(r.finance.netProfit).toBe(500_000);
    expect(r.admissions).not.toBeNull();
  });

  it('returns null rates for an empty month instead of 0% or 100%', async () => {
    const res = await http().get('/api/reports/overview?month=2001-01').set(as('OWNER')).expect(200);
    expect(res.body.attendance.rate).toBeNull();
    expect(res.body.finance.collected).toBe(0);
    expect(res.body.students.newThisMonth).toBe(0);
  });

  it('trims sections by role', async () => {
    const acc = (await http().get('/api/reports/overview').set(as('ACCOUNTANT')).expect(200)).body;
    expect(acc.finance.netProfit).toBe(500_000);
    expect(acc.admissions).toBeNull(); // no admissions.analytics
    const mgr = (await http().get('/api/reports/overview').set(as('MANAGER')).expect(200)).body;
    expect(mgr.finance.collected).toBe(500_000);
    expect(mgr.finance.netProfit).toBeUndefined(); // no expenses/salaries view
    expect(mgr.admissions).not.toBeNull();
    await http().get('/api/reports/overview').set(as('TEACHER')).expect(403);
    await http().get('/api/reports/overview?month=2026-13').set(as('OWNER')).expect(400);
  });

  it('adds group subjects to the directions list once, per tenant', async () => {
    const own = (await http().get('/api/subjects').set(as('OWNER')).expect(200)).body as Array<{ name: string }>;
    expect(own.filter((x) => x.name === 'Math')).toHaveLength(1);
    const other = (await http().get('/api/subjects').set(as('B')).expect(200)).body as Array<{ name: string }>;
    expect(other.filter((x) => x.name === 'Math')).toHaveLength(1);
  });

  it('serves the home dashboard from the server, scoped by role', async () => {
    const d = (await http().get('/api/reports/dashboard').set(as('OWNER')).expect(200)).body;
    expect(d.counts).toMatchObject({ activeStudents: 4, activeGroups: 2, attendanceMarks: 4 });
    expect(d.attendance.rates.month).toBe(25);
    expect(d.attendance.week).toHaveLength(7);
    expect(d.attendance.months).toHaveLength(12);
    expect(d.attendance.days).toHaveLength(14);
    expect(d.finance.revenueByMonth).toHaveLength(12);
    expect(d.attendance.months[0].month).toBe(`${now.year}-01`);
    expect(d.attendance.months.find((m: { month: string }) => m.month === month)).toEqual({ month, marks: 4 });
    expect(d.groupFill[0]).toMatchObject({ id: g1, students: 2, maxStudents: 10 });
    expect(d.finance).toMatchObject({ monthRevenue: 500_000, debtorCount: 2, paymentStatus: { paid: 1, total: 1 } });

    // A teacher with no groups of their own sees nothing and no money.
    const t = (await http().get('/api/reports/dashboard').set(as('TEACHER')).expect(200)).body;
    expect(t.scopedToOwnGroups).toBe(true);
    expect(t.counts).toMatchObject({ activeStudents: 0, activeGroups: 0, attendanceMarks: 0 });
    expect(t.finance).toBeNull();
    expect(t.attendance.rates.month).toBeNull();
  });
});
